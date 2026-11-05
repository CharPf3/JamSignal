/**
 * The search pipeline, in one place.
 *
 * Previously this logic existed twice — once in `api/events/route.ts` and again
 * in `api/test-pipeline/route.ts`, 130 lines of copy-paste that were guaranteed
 * to drift. The debug endpoint now asks the same function for the same work and
 * differs only in how much of the result it prints.
 *
 * Shape: candidate generation, then ranking.
 *
 *   1. geocode the query
 *   2. ask Ticketmaster who is playing nearby   (throttled, retried, cached)
 *   3. join against the artist index            (no live enrichment if warm)
 *   4. group by artist and rank
 *
 * Only step 3 can touch a music API, and only for artists never seen before.
 */

import { missingKeys } from './core/env'
import { geocodeLocation } from './sources/geocoding'
import { fetchEvents } from './sources/ticketmaster'
import { lookupArtists } from './artists'
import { resetCacheBreaker, cacheStatus } from './artists/cache'
import { DISPLAY_THRESHOLD, MARGINAL_THRESHOLD } from './scoring/weights'
import type { ArtistGroup, SearchResponse } from '@/types'

export type SearchOptions = {
  location: string
  radiusMiles: number
  days: number
  /** Minimum score to include. Defaults to the display threshold. */
  minScore?: number
  /** Include everything, scored or not. Used by the debug endpoint. */
  includeFiltered?: boolean
}

export type SearchFailure = { ok: false; status: number; error: string }
export type SearchSuccess = { ok: true; data: SearchResponse; filtered: ArtistGroup[] }

export const RADIUS_LIMITS = { min: 10, max: 300 } as const
export const DAYS_LIMITS = { min: 7, max: 180 } as const

function dateRange(days: number): { startDate: string; endDate: string } {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: fmt(now), endDate: fmt(end) }
}

export async function search(options: SearchOptions): Promise<SearchSuccess | SearchFailure> {
  const started = Date.now()
  const { location, radiusMiles, days } = options

  if (!location || location.trim().length < 2) {
    return { ok: false, status: 400, error: 'Enter a city, state or ZIP code.' }
  }
  if (radiusMiles < RADIUS_LIMITS.min || radiusMiles > RADIUS_LIMITS.max) {
    return { ok: false, status: 400, error: `Radius must be between ${RADIUS_LIMITS.min} and ${RADIUS_LIMITS.max} miles.` }
  }
  if (days < DAYS_LIMITS.min || days > DAYS_LIMITS.max) {
    return { ok: false, status: 400, error: `Date range must be between ${DAYS_LIMITS.min} and ${DAYS_LIMITS.max} days.` }
  }

  resetCacheBreaker()

  const geo = await geocodeLocation(location.trim())
  if (!geo) {
    return { ok: false, status: 404, error: `Couldn't find "${location.trim()}". Try a city and state, or a ZIP code.` }
  }

  // ── Candidate generation ────────────────────────────────────────────────
  const { startDate, endDate } = dateRange(days)
  const { events, queriesIssued, queriesFailed, complete } = await fetchEvents({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radius: radiusMiles,
    startDate,
    endDate,
  })

  // ── Ranking ─────────────────────────────────────────────────────────────
  // The listing title and Ticketmaster subgenre are passed along purely to
  // order the analysis budget (see artists/priority.ts). Neither contributes to
  // the score.
  const candidates = new Map<string, { artistName: string; eventTitle: string; tmSubgenre: string | null }>()
  for (const event of events) {
    if (!candidates.has(event.artist_name)) {
      candidates.set(event.artist_name, {
        artistName: event.artist_name,
        eventTitle: event.event_title,
        tmSubgenre: event.tm_subgenre,
      })
    }
  }

  const { results, cached, analyzed, pending } = await lookupArtists([...candidates.values()])

  const groups = new Map<string, ArtistGroup>()
  for (const event of events) {
    const lookup = results.get(event.artist_name)
    const analysis = lookup?.analysis ?? null

    let group = groups.get(event.artist_name)
    if (!group) {
      group = {
        artist_name: analysis?.name ?? event.artist_name,
        score: analysis?.score ?? 0,
        score_label: analysis?.score_label ?? 'Not yet analysed',
        reasons: analysis?.reasons ?? [],
        signals: analysis?.signals ?? [],
        notable_songs: analysis?.notable_songs ?? [],
        attribution_url: analysis?.attribution_url ?? null,
        name_ambiguous: analysis?.name_ambiguous ?? false,
        pending: lookup?.pending ?? true,
        events: [],
      }
      groups.set(event.artist_name, group)
    }
    group.events.push(event)
  }

  const minScore = options.minScore ?? DISPLAY_THRESHOLD
  const all = [...groups.values()]

  // Pending artists are held back rather than shown with a 0 — we have not
  // looked at them yet, which is different from having found nothing.
  const surfaced = all.filter((g) => !g.pending && g.score >= minScore)
  const marginal = all.filter(
    (g) => !g.pending && g.score < minScore && g.score >= MARGINAL_THRESHOLD
  )
  const filtered = all.filter((g) => g.pending || g.score < minScore)

  for (const group of all) {
    group.events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  }

  // Deterministic ordering: score, then soonest show, then name.
  const byRank = (a: ArtistGroup, b: ArtistGroup): number =>
    b.score - a.score ||
    (a.events[0]?.date ?? '').localeCompare(b.events[0]?.date ?? '') ||
    a.artist_name.localeCompare(b.artist_name)

  surfaced.sort(byRank)
  marginal.sort(byRank)
  filtered.sort(byRank)

  const shown = options.includeFiltered ? [...surfaced, ...filtered] : surfaced

  return {
    ok: true,
    filtered,
    data: {
      location: geo,
      radius: radiusMiles,
      days,
      groups: shown,
      marginal: options.includeFiltered ? [] : marginal,
      total_events: shown.reduce((sum, g) => sum + g.events.length, 0),
      diagnostics: {
        raw_events: events.length,
        unique_artists: candidates.size,
        cached_artists: cached,
        analyzed_now: analyzed,
        pending_artists: pending,
        surfaced: surfaced.length,
        complete: complete && pending === 0,
        queries_issued: queriesIssued,
        queries_failed: queriesFailed,
        missing_config: [
          ...missingKeys(),
          ...(cacheStatus().state === 'ok' ? [] : [`artist cache ${cacheStatus().state}`]),
        ],
        elapsed_ms: Date.now() - started,
      },
    },
  }
}
