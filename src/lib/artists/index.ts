/**
 * The artist index — the layer that makes search fast and repeatable.
 *
 * Jam bands do not change between searches, so analysing them on the request
 * path is the wrong place for the work. The old pipeline enriched every artist
 * inline, serially, with hardcoded `setTimeout(220)` and `setTimeout(550)`
 * pauses between calls. Measured against production:
 *
 *   Madison, 10mi  ->  25.5s
 *   Madison, 25mi  ->  96.6s and 142.8s on two identical runs
 *   Madison, 50mi  ->  no response at 120s
 *
 * The upstream APIs are not slow — Last.fm averaged 221ms and setlist.fm 230ms
 * per call. The cost was entirely self-inflicted.
 *
 * This module separates the two concerns. `lookupArtists` resolves names
 * against the stored index and returns immediately. Anything missing is
 * analysed under a budget, prioritised so the budget is spent on plausible
 * candidates, and whatever does not fit comes back marked `pending` rather than
 * scored low — a band we have not looked at yet is unknown, not uninteresting.
 */

import { mapLimit, dedupe } from '@/lib/core/concurrency'
import { normalizeName } from '@/lib/canon/normalize'
import { isKnownAct } from '@/lib/canon/acts'
import { resolveArtist, type ResolvedArtist } from '@/lib/sources/musicbrainz'
import { getLastFmData, EMPTY_LASTFM, type LastFmData } from '@/lib/sources/lastfm'
import { getSetlistData, EMPTY_SETLIST } from '@/lib/sources/setlistfm'
import { scoreArtist, type ScoringResult } from '@/lib/scoring'
import { AMBIGUOUS_TAG_FLOOR } from '@/lib/scoring/weights'
import { readArtists, writeArtists } from './cache'
import { prioritize, type PriorityInput } from './priority'

export type ArtistAnalysis = {
  name: string
  mbid: string | null
  score: number
  score_label: string
  reasons: string[]
  signals: Array<{ key: string; label: string; points: number; max: number; detail: string | null }>
  notable_songs: string[]
  attribution_url: string | null
  name_ambiguous: boolean
}

export type ArtistLookup = {
  analysis: ArtistAnalysis | null
  /** Not yet analysed — the UI shows this as pending, not as a low score. */
  pending: boolean
  cached: boolean
}

/**
 * How many uncached artists to analyse per request.
 *
 * Larger than it looks affordable because of the cascade below: most artists
 * cost two Last.fm calls at 4/second and stop there. Only plausible candidates
 * reach MusicBrainz, whose 1 request/second limit is what actually bounds a
 * cold search.
 */
const ANALYSIS_BUDGET = 30

const ANALYSIS_CONCURRENCY = 6

const toAnalysis = (name: string, mbid: string | null, result: ScoringResult): ArtistAnalysis => ({
  name,
  mbid,
  score: result.score,
  score_label: result.label,
  reasons: result.reasons,
  signals: result.contributions.map((c) => ({
    key: c.key, label: c.label, points: c.points, max: c.max, detail: c.detail,
  })),
  notable_songs: result.notableSongs,
  attribution_url: result.attributionUrl,
  name_ambiguous: result.nameAmbiguous,
})

/**
 * Whether an artist is worth the expensive half of the analysis.
 *
 * MusicBrainz allows one request per second, so it, not Last.fm, sets the
 * latency of a cold search. Spending a second resolving an artist who has a
 * well-populated Last.fm page showing no jam tags and no jam-adjacent
 * listeners buys nothing.
 *
 * `!lastfm.found` deliberately passes the gate: an artist Last.fm has never
 * heard of is usually a local or unsigned act, and setlists are then the only
 * evidence available. Those are exactly the discoveries worth making.
 */
function warrantsResolution(name: string, lastfm: LastFmData): boolean {
  if (!lastfm.found) return true
  if (isKnownAct(name)) return true
  // Thresholds rather than `> 0`: a stray tag or a single weak similarity
  // match is noise, and an earlier version spent MusicBrainz seconds resolving
  // Jack White and The Jayhawks off exactly that.
  if (lastfm.jamTagStrength >= AMBIGUOUS_TAG_FLOOR) return true
  if (lastfm.similarityAffinity >= 0.1) return true
  if (lastfm.adjacentTagStrength >= 0.2) return true
  return false
}

/**
 * Analyses one artist: cheap signal first, expensive identity work only if
 * warranted.
 *
 * Within the expensive half, MusicBrainz comes before setlist.fm because
 * setlist.fm must be queried by MBID — its own name search returns the wrong
 * band often enough to have silently zeroed out several of the app's headline
 * acts. Last.fm stays name-addressed: its MBID index is stale for ambiguous
 * names, so querying Goose's correct MBID still returns the Belgian act's tags.
 */
export const analyzeArtist = dedupe(
  (name: string) => normalizeName(name),
  async (name: string): Promise<ArtistAnalysis> => {
    const lastfm = await getLastFmData(name).catch(() => EMPTY_LASTFM)

    if (!warrantsResolution(name, lastfm)) {
      const result = scoreArtist({ artistName: name, resolved: null, lastfm, setlist: EMPTY_SETLIST })
      return toAnalysis(name, null, result)
    }

    let resolved: ResolvedArtist | null = null
    try {
      resolved = await resolveArtist(name)
    } catch {
      resolved = null
    }

    const setlist = resolved
      ? await getSetlistData(resolved.mbid).catch(() => EMPTY_SETLIST)
      : EMPTY_SETLIST

    // Re-read tags under MusicBrainz's spelling when it differs — it is the
    // canonical form and Last.fm indexes some artists only under it.
    const finalLastfm =
      resolved && normalizeName(resolved.name) !== normalizeName(name) && lastfm.jamTagStrength === 0
        ? await getLastFmData(resolved.name).catch(() => lastfm)
        : lastfm

    const best = finalLastfm.jamTagStrength > lastfm.jamTagStrength ? finalLastfm : lastfm
    const result = scoreArtist({ artistName: name, resolved, lastfm: best, setlist })
    return toAnalysis(resolved?.name ?? name, resolved?.mbid ?? null, result)
  }
)

export type LookupCandidate = PriorityInput & { artistName: string }

/**
 * Resolves many artists against the index, analysing up to the budget.
 *
 * Returns a map keyed by the *input* artist name so callers can join back to
 * events.
 */
export async function lookupArtists(
  candidates: LookupCandidate[]
): Promise<{ results: Map<string, ArtistLookup>; cached: number; analyzed: number; pending: number }> {
  const results = new Map<string, ArtistLookup>()

  // Collapse spellings that normalise to the same artist, so "The String
  // Cheese Incident" and "String Cheese Incident" share one analysis.
  const byKey = new Map<string, { key: string; artistName: string; eventTitle?: string; tmSubgenre?: string | null; spellings: string[] }>()
  for (const candidate of candidates) {
    const key = normalizeName(candidate.artistName)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) existing.spellings.push(candidate.artistName)
    else byKey.set(key, { ...candidate, key, spellings: [candidate.artistName] })
  }

  const entries = [...byKey.values()]
  const stored = await readArtists(entries.map((e) => e.key))

  const missing: typeof entries = []
  for (const entry of entries) {
    const hit = stored.get(entry.key)
    if (hit) {
      for (const name of entry.spellings) results.set(name, { analysis: hit, pending: false, cached: true })
    } else {
      missing.push(entry)
    }
  }

  // Prioritised, not alphabetical — see priority.ts for why that distinction
  // cost a Madison search every one of its twelve slots.
  const ordered = prioritize(missing)
  const toAnalyze = ordered.slice(0, ANALYSIS_BUDGET)
  const deferred = ordered.slice(ANALYSIS_BUDGET)

  const analyses = await mapLimit(toAnalyze, ANALYSIS_CONCURRENCY, async (entry) => {
    try {
      return { entry, analysis: await analyzeArtist(entry.artistName) }
    } catch (err) {
      console.warn(`[artists] analysis failed for "${entry.artistName}":`, err)
      return { entry, analysis: null }
    }
  })

  for (const { entry, analysis } of analyses) {
    for (const name of entry.spellings) {
      results.set(name, { analysis, pending: analysis === null, cached: false })
    }
  }

  for (const entry of deferred) {
    for (const name of entry.spellings) {
      results.set(name, { analysis: null, pending: true, cached: false })
    }
  }

  // One batched write, not one per artist. Awaited because a serverless process
  // can be frozen as soon as the response is sent.
  const writable = analyses.filter((a) => a.analysis !== null)
  if (writable.length > 0) {
    await writeArtists(
      writable.map((a) => ({
        key: a.entry.key,
        name: a.entry.artistName,
        mbid: a.analysis!.mbid,
        analysis: a.analysis!,
      }))
    )
  }

  return {
    results,
    cached: entries.length - missing.length,
    analyzed: writable.length,
    pending: deferred.length + analyses.filter((a) => a.analysis === null).length,
  }
}
