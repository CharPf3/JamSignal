/**
 * MusicBrainz — entity resolution.
 *
 * This is the layer the app was missing, and its absence was breaking the best
 * data source rather than the obvious one. Setlist.fm's own `search/artists`
 * returns fuzzy, alphabetically-ordered matches, so taking the first result
 * resolved several of the app's own headline acts to unrelated artists:
 *
 *   "Goose"    -> "8track Gorilla & Freedom Goose"   -> 404, no setlist data
 *   "Neighbor" -> "Neighbor [lo-fi beatmaker]"       -> 404, no setlist data
 *   "Eggy"     -> "Eggy [Emily Willoughby]"          -> 404, no setlist data
 *
 * Those bands then sat at the bare tier floor with zero evidence. Resolving
 * through MusicBrainz first and querying setlist.fm by MBID fixes all three
 * (824, 291 and 747 setlists respectively).
 *
 * MusicBrainz is free and keyless but allows one request per second, which is
 * why resolution belongs in the background artist index rather than on the
 * request path.
 *
 * Note: the MBID is reliable for setlist.fm but NOT for Last.fm. Last.fm
 * periodically syncs MBIDs and the mapping is stale for ambiguous names —
 * querying Goose's correct MBID still returns the Belgian electro act's tags —
 * so Last.fm stays name-based with autocorrect.
 */

import { USER_AGENT } from '@/lib/core/env'
import { fetchJson } from '@/lib/core/http'
import { throttle } from '@/lib/core/concurrency'
import { normalizeName } from '@/lib/canon/normalize'
import { disambiguationSuggestsJam } from '@/lib/canon/acts'

export type ResolvedArtist = {
  mbid: string
  name: string
  disambiguation: string | null
  country: string | null
  /** MusicBrainz community tags — sparse, but curated. */
  tags: string[]
  /** MusicBrainz relevance score, 0–100. */
  score: number
  /** Disambiguation text identifies this as a jam act. */
  jamDisambiguation: boolean
  /**
   * More than one distinct artist shares this exact name.
   *
   * This matters for scoring, not just resolution. Last.fm is name-addressed
   * and has no way to tell the Connecticut Goose from the Belgian one — it
   * returns "electronic, electro, new rave" for the jam band. When a name is
   * ambiguous, the absence of jam tags is unreliable rather than informative,
   * so scoring treats the Last.fm signal as unavailable instead of zero.
   */
  ambiguous: boolean
}

type MbArtist = {
  id: string
  name: string
  score: number
  disambiguation?: string
  country?: string
  type?: string
  tags?: Array<{ name: string; count: number }>
}

/** MusicBrainz asks for at most one request per second. */
const limit = throttle(1)

/**
 * Minimum relevance to accept. MusicBrainz scores an exact name match 100, so
 * anything below this is a fuzzy match on a different artist.
 */
const MIN_SCORE = 85

/**
 * Resolves an artist name to a MusicBrainz entity, or null when no confident
 * match exists.
 *
 * Returning null is a deliberate outcome, not a failure. For "Melt" the
 * top-scored result is "Melt-Banana"; resolving nothing and letting the other
 * signals carry the artist is strictly better than resolving confidently wrong.
 */
export async function resolveArtist(name: string): Promise<ResolvedArtist | null> {
  const query = name.trim()
  if (query.length < 2) return null

  const params = new URLSearchParams({
    query: `artist:"${query.replace(/"/g, '')}"`,
    fmt: 'json',
    limit: '10',
  })

  const data = await limit(() =>
    fetchJson<{ artists?: MbArtist[] }>(`https://musicbrainz.org/ws/2/artist?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      revalidate: 60 * 60 * 24 * 30,
    })
  ).catch(() => null)

  const candidates = data?.artists ?? []
  if (candidates.length === 0) return null

  const target = normalizeName(query)
  const exact = candidates.filter((a) => normalizeName(a.name) === target)

  // Prefer an exact name match whose disambiguation marks it as a jam act —
  // this is what distinguishes the Connecticut Goose from the Belgian one.
  const pick =
    exact.find((a) => disambiguationSuggestsJam(a.disambiguation ?? null)) ??
    exact.find((a) => a.score >= MIN_SCORE) ??
    null

  if (!pick) return null

  return {
    mbid: pick.id,
    name: pick.name,
    disambiguation: pick.disambiguation ?? null,
    country: pick.country ?? null,
    tags: (pick.tags ?? []).map((t) => t.name.toLowerCase()),
    score: pick.score,
    jamDisambiguation: disambiguationSuggestsJam(pick.disambiguation ?? null),
    ambiguous: exact.length > 1,
  }
}
