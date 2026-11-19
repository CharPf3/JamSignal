/**
 * Venue calendars as a second event source.
 *
 * Two halves that must not be confused:
 *
 *   ingestVenue      the write path. One feed fetch plus one page fetch per
 *                    event — 114 for Cervantes — with the host's crawl-delay
 *                    honoured. Minutes, not milliseconds. Scheduled only, via
 *                    scripts/ingest-venues.ts. Never called from a request.
 *
 *   venueEventsNear  the read path. Filters the registry by distance in code,
 *                    then one query against the cache. This is what search uses.
 *
 * Keeping them apart is the same decision the artist index made, for the same
 * measured reason: analysis on the request path is what made a 25-mile search
 * take 96 seconds.
 */

import { fetchText, HttpError, stripSecrets } from '@/lib/core/http'
import { sleep } from '@/lib/core/concurrency'
import { extractPerformerName } from '@/lib/canon/normalize'
import type { Event } from '@/types'
import { VENUES, type RegisteredVenue } from './registry'
import { parseFeed, WORDPRESS_EVENT_URL } from './feed'
import { extractEvent, type VenueEvent } from './jsonld'
import { assessFreshness, type FreshnessVerdict } from './freshness'
import { readVenueEvents, replaceVenueEvents } from './store'

export { venueStoreState } from './store'
export { VENUES } from './registry'

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

/** Registered venues within the search radius. */
export function venuesWithin(latitude: number, longitude: number, radiusMiles: number): RegisteredVenue[] {
  return VENUES.filter(
    (v) => haversineMiles(latitude, longitude, v.latitude, v.longitude) <= radiusMiles
  )
}

export type VenueEventsResult = {
  events: Event[]
  /** Registered venues inside the radius, whether or not they had events. */
  venuesInRange: number
  /** Venues inside the radius with cached events — the rest are un-ingested. */
  venuesWithData: number
}

/**
 * Cached venue events near a point, shaped as the pipeline's `Event`.
 *
 * Returns nothing rather than failing when the store is unconfigured: venue
 * calendars are an addition to Ticketmaster, so a missing cache costs coverage
 * and must never cost the search.
 */
export async function venueEventsNear(args: {
  latitude: number
  longitude: number
  radiusMiles: number
  startDate: string
  endDate: string
}): Promise<VenueEventsResult> {
  const inRange = venuesWithin(args.latitude, args.longitude, args.radiusMiles)
  if (inRange.length === 0) return { events: [], venuesInRange: 0, venuesWithData: 0 }

  const byKey = new Map(inRange.map((v) => [v.key, v]))
  const rows = await readVenueEvents({
    venueKeys: inRange.map((v) => v.key),
    startDate: args.startDate,
    endDate: args.endDate,
  })

  const withData = new Set<string>()
  const events: Event[] = []

  for (const row of rows) {
    const venue = byKey.get(row.venue_key)
    if (!venue) continue
    withData.add(row.venue_key)

    events.push({
      // Namespaced so a venue id can never collide with a Ticketmaster one.
      id: `venue:${row.url}`,
      source: 'venue',
      event_title: row.title,
      // The billing is not the performer: "Mihali Presents: MihaliDaze w/ ..."
      // has to resolve to Mihali for the music databases to find anything. Done
      // at read time with the same normaliser the Ticketmaster path uses, so
      // improving it does not require re-ingesting.
      artist_name: extractPerformerName(row.title),
      venue_name: venue.name,
      venue_city: venue.city,
      venue_state: venue.state,
      venue_latitude: venue.latitude,
      venue_longitude: venue.longitude,
      date: row.event_date,
      start_time: row.start_time,
      ticket_url: row.ticket_url,
      distance_miles: Math.round(
        haversineMiles(args.latitude, args.longitude, venue.latitude, venue.longitude)
      ),
      // Ticketmaster's taxonomy, which a venue feed has no equivalent of. It is
      // display-only and excluded from scoring, so null costs nothing.
      tm_genre: null,
      tm_subgenre: null,
    })
  }

  return { events, venuesInRange: inRange.length, venuesWithData: withData.size }
}

export type IngestResult = {
  venue: string
  /** Event-page URLs the feed advertised. */
  listed: number
  /** Pages that yielded a schema.org Event. */
  extracted: number
  /** Events the feed promoted at somebody else's venue, and skipped. */
  offsite: number
  /** Rows written, or 0 when the feed was rejected or this was a dry run. */
  written: number
  freshness: FreshnessVerdict
  errors: string[]
}

/**
 * Ingests one venue's calendar.
 *
 * Nothing is written unless the feed passes the freshness check. Salvage
 * Station is why: its iCal is valid, 147KB, fifty events, and the newest is
 * from 2021. Writing that would have the app advertising shows from five years
 * ago, which is a worse failure than having no data for the venue at all.
 */
export async function ingestVenue(
  venue: RegisteredVenue,
  options: { dryRun?: boolean; onProgress?: (done: number, total: number) => void } = {}
): Promise<IngestResult> {
  const errors: string[] = []

  const feedXml = await fetchText(venue.feedUrl, { revalidate: false, timeoutMs: 20_000 })
  const feed = parseFeed(feedXml, WORDPRESS_EVENT_URL)

  const extracted: VenueEvent[] = []
  const offsite: string[] = []
  for (const [index, entry] of feed.entries.entries()) {
    try {
      const html = await fetchText(entry.url, { revalidate: false, timeoutMs: 20_000 })
      const event = extractEvent(html, entry.url)
      if (!event) {
        errors.push(`no Event JSON-LD: ${entry.url}`)
      } else if (event.locationName && !venue.locationPattern.test(event.locationName)) {
        // The feed promotes shows this venue books elsewhere. Taking them would
        // put Red Rocks, or WinterWonderGrass 150 miles away, at this address.
        offsite.push(`${event.name} @ ${event.locationName}`)
      } else {
        extracted.push(event)
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 'network'
      errors.push(`fetch failed (${status}): ${stripSecrets(entry.url)}`)
    }

    options.onProgress?.(index + 1, feed.entries.length)
    // Courtesy delay between page fetches, per the host's robots.txt.
    if (index < feed.entries.length - 1) await sleep(venue.crawlDelaySeconds * 1000)
  }

  const freshness = assessFreshness({
    lastBuild: feed.lastBuild,
    eventDates: extracted.map((e) => new Date(e.startDate)),
  })

  if (!freshness.fresh || options.dryRun) {
    return {
      venue: venue.key,
      listed: feed.entries.length,
      extracted: extracted.length,
      offsite: offsite.length,
      written: 0,
      freshness,
      errors,
    }
  }

  const { written, error } = await replaceVenueEvents(venue.key, extracted)
  if (error) errors.push(`write failed: ${error}`)

  return {
    venue: venue.key,
    listed: feed.entries.length,
    extracted: extracted.length,
    offsite: offsite.length,
    written,
    freshness,
    errors,
  }
}
