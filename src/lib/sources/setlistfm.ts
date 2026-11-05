/**
 * Setlist.fm — what a band actually plays live.
 *
 * Two corrections from the measured data.
 *
 * COVER ATTRIBUTION IS THE REAL SIGNAL. Each setlist song may carry a `cover`
 * field, which is an *artist* object naming the original performer. The previous
 * code passed `song.cover.name` into a song-title matcher, so it was feeding
 * artist names like "Grateful Dead" and "Phish" into a lookup of song titles —
 * never matching, pure waste. Read correctly it is the best thing this API
 * offers: setlist.fm stating outright that a band covered the Grateful Dead.
 * Measured AUC 0.81, versus 0.32 for the raw song counts the old code used.
 *
 * ABSENCE OF COVERS MEANS NOTHING. The signal is high-precision and low-recall,
 * because the jammiest bands cover least — they play originals:
 *
 *   Trey Anastasio      17.07 jam covers/show      Widespread Panic   0.07
 *   Dark Star Orchestra 11.33                      Disco Biscuits     0.00
 *   JRAD                 9.33                      Spafford           0.00
 *
 * So cover attribution is strictly a bonus and never a gate. Its one notable
 * false positive is Marcus King (0.55/show, covering the Allman Brothers) —
 * exactly the act that scored implausibly high before.
 *
 * Everything is reported per show rather than as a total. Raw counts measured
 * how much data setlist.fm happens to hold: 15 shows with one jam song each
 * scored identically to 2 shows with five each. Songs-per-show is actively
 * anti-correlated with being a jam band (14.98 jam vs 17.90 non-jam) — jam
 * bands play fewer, longer songs — so it is not used at all.
 */

import { env } from '@/lib/core/env'
import { fetchJson, HttpError } from '@/lib/core/http'
import { throttle } from '@/lib/core/concurrency'
import { normalizeName } from '@/lib/canon/normalize'
import { isCoverReferenceAct } from '@/lib/canon/acts'
import { isJamSong, isSignatureSong, isGdSong } from '@/lib/canon/songs'

export type SetlistData = {
  /** Shows examined — the denominator for every rate below. */
  showsAnalyzed: number
  /** Jam-canon covers per show. The primary signal. */
  jamCoversPerShow: number
  /** Share of shows containing at least one jam-canon cover, 0–1. */
  showsWithJamCover: number
  /** Distinct canon songs per show (originals, by title). */
  canonSongsPerShow: number
  /** Share of shows containing a signature improvisational vehicle, 0–1. */
  showsWithSignature: number
  /** Seed acts this band covers, most frequent first. */
  coveredActs: string[]
  /** Canon songs seen, for display. Original casing preserved. */
  notableSongs: string[]
  /** Whether any Grateful Dead material appeared. */
  playsDeadMaterial: boolean
  /** Required by the setlist.fm terms of service. */
  attributionUrl: string
  found: boolean
}

export const EMPTY_SETLIST: SetlistData = {
  showsAnalyzed: 0,
  jamCoversPerShow: 0,
  showsWithJamCover: 0,
  canonSongsPerShow: 0,
  showsWithSignature: 0,
  coveredActs: [],
  notableSongs: [],
  playsDeadMaterial: false,
  attributionUrl: 'https://www.setlist.fm',
  found: false,
}

type SetlistFmSong = { name: string; cover?: { name: string } }
type SetlistFmSetlist = {
  artist: { name: string; url: string }
  sets?: { set?: Array<{ song?: SetlistFmSong[] }> }
  url: string
}
type SetlistsResponse = { setlist?: SetlistFmSetlist[]; total?: number }

/** Setlist.fm permits roughly 2 requests per second. */
const limit = throttle(2)

/** How many recent shows to examine. */
const SHOWS_TO_ANALYZE = 15

/** Placeholder setlist.fm uses for public-domain material. */
const TRADITIONAL = new Set(['traditional', 'unknown'])

/**
 * Fetches and summarises recent setlists for a MusicBrainz artist id.
 *
 * Takes an MBID rather than a name on purpose — see sources/musicbrainz.ts for
 * why name-based resolution silently returned the wrong band.
 */
export async function getSetlistData(mbid: string): Promise<SetlistData> {
  const apiKey = env.setlistfmKey()
  if (!apiKey || !mbid) return EMPTY_SETLIST

  let data: SetlistsResponse | null
  try {
    data = await limit(() =>
      fetchJson<SetlistsResponse>(`https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=1`, {
        headers: { 'x-api-key': apiKey, Accept: 'application/json' },
        revalidate: 60 * 60 * 24 * 7,
      })
    )
  } catch (err) {
    // 404 is setlist.fm's answer for "this artist has no setlists" — a real,
    // cacheable result. Anything transient has already been retried.
    if (err instanceof HttpError && err.status === 404) return EMPTY_SETLIST
    return EMPTY_SETLIST
  }

  const shows = (data?.setlist ?? [])
    .filter((s) => (s.sets?.set ?? []).some((set) => (set.song ?? []).length > 0))
    .slice(0, SHOWS_TO_ANALYZE)

  if (shows.length === 0) return EMPTY_SETLIST

  let jamCoverTotal = 0
  let showsWithCover = 0
  let showsWithSignature = 0
  let playsDead = false

  const coverCounts = new Map<string, number>()
  const canonSeen = new Map<string, string>() // normalised -> original casing
  const canonPerShow: number[] = []

  for (const show of shows) {
    let showJamCovers = 0
    let showSignature = false
    const showCanon = new Set<string>()

    for (const set of show.sets?.set ?? []) {
      for (const song of set.song ?? []) {
        const coverName = song.cover?.name
        if (coverName && !TRADITIONAL.has(normalizeName(coverName))) {
          const key = normalizeName(coverName)
          if (isCoverReferenceAct(coverName)) {
            showJamCovers++
            coverCounts.set(coverName, (coverCounts.get(coverName) ?? 0) + 1)
            if (key === 'grateful dead') playsDead = true
          }
        }

        if (isJamSong(song.name)) {
          showCanon.add(song.name.toLowerCase())
          canonSeen.set(song.name.toLowerCase(), song.name)
          if (isGdSong(song.name)) playsDead = true
          if (isSignatureSong(song.name)) showSignature = true
        }
      }
    }

    jamCoverTotal += showJamCovers
    if (showJamCovers > 0) showsWithCover++
    if (showSignature) showsWithSignature++
    canonPerShow.push(showCanon.size)
  }

  const n = shows.length
  const round = (value: number) => Number(value.toFixed(3))

  return {
    showsAnalyzed: n,
    jamCoversPerShow: round(jamCoverTotal / n),
    showsWithJamCover: round(showsWithCover / n),
    canonSongsPerShow: round(canonPerShow.reduce((a, b) => a + b, 0) / n),
    showsWithSignature: round(showsWithSignature / n),
    coveredActs: [...coverCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name),
    notableSongs: [...canonSeen.values()].slice(0, 8),
    playsDeadMaterial: playsDead,
    attributionUrl: shows[0]?.artist.url ?? 'https://www.setlist.fm',
    found: true,
  }
}
