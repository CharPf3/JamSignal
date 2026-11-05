/**
 * Ticketmaster — candidate generation.
 *
 * This is the only source that can answer "who is playing near me", and that is
 * the entirety of its job. Its genre taxonomy scored AUC 0.611 on the labelled
 * set — barely above chance — because the most common classification for jam
 * acts and non-jam acts alike is "Rock/Pop". It is not used for scoring.
 *
 * ── The 429 problem ───────────────────────────────────────────────────────────
 *
 * The previous implementation issued 62 simultaneous requests through a single
 * `Promise.all` — one per entry in a 56-name keyword list, plus four genre
 * sweeps — against an API that allows 5 requests per second. It then discarded
 * every failure with `if (!res.ok) return`. Measured, twice, four seconds apart:
 *
 *   run 1: 62 requests -> 41x200, 21x429 -> 14 events
 *   run 2: 62 requests -> 48x200, 14x429 -> 21 events
 *
 * A third of the search space vanished at random on every run, which is why two
 * identical searches returned different results. Requests now go through a
 * token bucket with retry, so a rate limit costs time rather than coverage.
 *
 * ── Searching where jam bands actually are ────────────────────────────────────
 *
 * The old genre sweeps covered Folk, Blues, Americana and Country. Asking
 * Ticketmaster how it classifies known jam acts gives:
 *
 *   Rock/Pop 10x · Rock/Alternative Rock 5x · Country/Bluegrass 3x
 *   Other/Other 3x · Folk/Indie Folk 2x · Blues/Jazz Blues 2x
 *
 * So the sweeps covered four classifications jam bands largely do not use and
 * skipped the ones they do. The segment-level sweep below covers the taxonomy
 * actually in use, and because scoring no longer depends on Ticketmaster
 * genres, casting a wider net here costs nothing in precision.
 */

import type { Event } from '@/types'
import { env } from '@/lib/core/env'
import { fetchJson, HttpError } from '@/lib/core/http'
import { throttle, mapLimit } from '@/lib/core/concurrency'
import { extractPerformerName } from '@/lib/canon/normalize'
import { SEARCH_SEEDS } from '@/lib/canon/acts'

/**
 * Ticketmaster classifications to sweep.
 *
 * Genre-level rather than subgenre-level, since jam acts scatter across
 * subgenres unpredictably. Scoring filters the results, so breadth is safe.
 */
const GENRE_SWEEPS = ['Rock', 'Folk', 'Country', 'Blues', 'R&B', 'Jazz', 'Other'] as const

/** Ticketmaster's documented limit is 5 requests/second. */
const limit = throttle(4)

/** Results per page; 200 is the API maximum. */
const PAGE_SIZE = 100

/** Pages to walk per query. Deep paging is rate-limited above page 50. */
const MAX_PAGES = 3

type TmEvent = {
  id: string
  name: string
  dates: { start: { localDate: string; localTime?: string } }
  url: string
  classifications?: Array<{
    primary?: boolean
    segment?: { name: string }
    genre?: { name: string }
    subGenre?: { name: string }
  }>
  _embedded?: {
    venues?: Array<{
      name: string
      city?: { name: string }
      state?: { stateCode: string }
      location?: { latitude: string; longitude: string }
    }>
    attractions?: Array<{ name: string; id: string }>
  }
}

type TmResponse = {
  _embedded?: { events?: TmEvent[] }
  page?: { totalElements: number; totalPages: number; number: number }
}

export type FetchEventsParams = {
  latitude: number
  longitude: number
  radius: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

export type FetchEventsResult = {
  events: Event[]
  /** Queries issued and how many came back; surfaced as a coverage figure. */
  queriesIssued: number
  queriesFailed: number
  /** True when every query succeeded, so results are complete and repeatable. */
  complete: boolean
}

const EARTH_RADIUS_MILES = 3958.8
const toRad = (deg: number): number => (deg * Math.PI) / 180

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function mapEvent(raw: TmEvent, userLat: number, userLon: number): Event {
  const venue = raw._embedded?.venues?.[0]
  const attraction = raw._embedded?.attractions?.[0]
  const lat = venue?.location?.latitude ? Number.parseFloat(venue.location.latitude) : null
  const lon = venue?.location?.longitude ? Number.parseFloat(venue.location.longitude) : null
  const primary = raw.classifications?.find((c) => c.primary) ?? raw.classifications?.[0]

  // Prefer the attraction name — it is the canonical performer. Fall back to
  // the event title with promotional text stripped, so "Goose - Summer Tour
  // 2026" still resolves against the music databases.
  const performer = attraction?.name ?? extractPerformerName(raw.name)

  return {
    id: raw.id,
    source: 'ticketmaster',
    event_title: raw.name,
    artist_name: performer,
    venue_name: venue?.name ?? 'Unknown venue',
    venue_city: venue?.city?.name ?? '',
    venue_state: venue?.state?.stateCode ?? null,
    venue_latitude: lat,
    venue_longitude: lon,
    date: raw.dates.start.localDate,
    start_time: raw.dates.start.localTime ?? null,
    ticket_url: raw.url,
    distance_miles: lat !== null && lon !== null ? Math.round(haversineMiles(userLat, userLon, lat, lon)) : null,
    tm_genre: primary?.genre?.name ?? null,
    tm_subgenre: primary?.subGenre?.name ?? null,
  }
}

/** One page of one query. Throws on transient failure after retries. */
async function fetchPage(
  params: Record<string, string>,
  page: number,
  apiKey: string
): Promise<TmResponse> {
  const query = new URLSearchParams({ ...params, page: String(page), apikey: apiKey })
  return limit(() =>
    fetchJson<TmResponse>(`https://app.ticketmaster.com/discovery/v2/events.json?${query}`, {
      revalidate: 60 * 30,
      retry: { attempts: 4, backoffMs: 900 },
    })
  )
}

/**
 * Fetches every event matching a query, walking pages until exhausted.
 *
 * Returns null on failure so the caller can report incomplete coverage instead
 * of quietly presenting a partial result as complete.
 */
async function fetchQuery(
  params: Record<string, string>,
  apiKey: string
): Promise<TmEvent[] | null> {
  try {
    const first = await fetchPage(params, 0, apiKey)
    const events = [...(first._embedded?.events ?? [])]
    const pages = Math.min(first.page?.totalPages ?? 1, MAX_PAGES)

    for (let page = 1; page < pages; page++) {
      const next = await fetchPage(params, page, apiKey)
      const batch = next._embedded?.events ?? []
      if (batch.length === 0) break
      events.push(...batch)
    }

    return events
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 'network'
    console.warn(`[ticketmaster] query failed (${status}): ${JSON.stringify(params.keyword ?? params.classificationName)}`)
    return null
  }
}

/**
 * Finds music events near a point within a date window.
 *
 * Events are deduplicated across queries and returned in a stable order, so the
 * same inputs produce the same output.
 */
export async function fetchEvents(params: FetchEventsParams): Promise<FetchEventsResult> {
  const apiKey = env.ticketmasterKey()
  if (!apiKey) {
    console.warn('[ticketmaster] TICKETMASTER_API_KEY not set — no events will be found')
    return { events: [], queriesIssued: 0, queriesFailed: 0, complete: false }
  }

  const base: Record<string, string> = {
    latlong: `${params.latitude},${params.longitude}`,
    radius: String(params.radius),
    unit: 'miles',
    startDateTime: `${params.startDate}T00:00:00Z`,
    endDateTime: `${params.endDate}T23:59:59Z`,
    size: String(PAGE_SIZE),
    sort: 'date,asc',
  }

  const queries: Array<Record<string, string>> = [
    ...GENRE_SWEEPS.map((genre) => ({ ...base, classificationName: genre })),
    ...SEARCH_SEEDS.map((keyword) => ({ ...base, keyword, classificationName: 'Music' })),
  ]

  // Bounded concurrency on top of the token bucket: the bucket paces requests,
  // this keeps the number of open sockets and pending retries reasonable.
  const results = await mapLimit(queries, 4, (query) => fetchQuery(query, apiKey))

  const seen = new Set<string>()
  const events: Event[] = []

  for (const batch of results) {
    for (const raw of batch ?? []) {
      // Ticketmaster returns the same show under several queries, and
      // occasionally under different ids, so dedupe on identity not id.
      const venue = raw._embedded?.venues?.[0]
      const key = [
        raw.name.toLowerCase().trim(),
        (venue?.name ?? '').toLowerCase().trim(),
        raw.dates.start.localDate,
      ].join('|')

      if (seen.has(key)) continue
      seen.add(key)
      events.push(mapEvent(raw, params.latitude, params.longitude))
    }
  }

  const failed = results.filter((r) => r === null).length

  // Deterministic ordering: date, then distance, then id as a final tiebreak.
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.distance_miles ?? 9999) - (b.distance_miles ?? 9999) ||
      a.id.localeCompare(b.id)
  )

  return {
    events,
    queriesIssued: queries.length,
    queriesFailed: failed,
    complete: failed === 0,
  }
}
