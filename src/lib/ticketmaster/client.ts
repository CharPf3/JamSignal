import type { Event } from '@/types'
import { TIER_1_KEYWORDS } from './keywords'

// Keyword searches — match against event titles, artist names, and descriptions.
// Tier 1 = specific band names. Discovery = genre words that appear in event text.
const DISCOVERY_KEYWORDS = [
  'bluegrass',
  'americana',
] as const

const ALL_KEYWORDS: string[] = [...TIER_1_KEYWORDS, ...DISCOVERY_KEYWORDS]

// Genre classification searches — use Ticketmaster's taxonomy, not keyword text.
// These find events tagged by genre even if those words never appear in the title.
// A local bluegrass act classified as "Folk" by Ticketmaster becomes discoverable here.
const GENRE_CLASSIFICATIONS = [
  'Folk',
  'Blues',
  'Americana',
  'Country',
] as const

type TicketmasterEvent = {
  id: string
  name: string
  dates: {
    start: { localDate: string }
  }
  url: string
  _embedded?: {
    venues?: Array<{
      name: string
      city: { name: string }
      state?: { stateCode: string }
      location?: { latitude: string; longitude: string }
    }>
    attractions?: Array<{
      name: string
      id: string
    }>
  }
}

type TicketmasterResponse = {
  _embedded?: { events?: TicketmasterEvent[] }
  page?: { totalElements: number }
}

export type FetchEventsParams = {
  latitude: number
  longitude: number
  radius: number
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
}

function mapEvent(raw: TicketmasterEvent, userLat: number, userLon: number): Event {
  const venue = raw._embedded?.venues?.[0]
  const attraction = raw._embedded?.attractions?.[0]
  const venueLat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : null
  const venueLon = venue?.location?.longitude ? parseFloat(venue.location.longitude) : null

  const distance =
    venueLat !== null && venueLon !== null
      ? haversineDistance(userLat, userLon, venueLat, venueLon)
      : null

  return {
    id: raw.id,
    source: 'ticketmaster',
    band_name: raw.name,
    // artist_name is the canonical performer name used for Spotify/Setlist lookups.
    // Falls back to event title when Ticketmaster has no attraction data.
    artist_name: attraction?.name ?? raw.name,
    venue_name: venue?.name ?? 'Unknown Venue',
    venue_city: venue?.city.name ?? '',
    venue_state: venue?.state?.stateCode ?? null,
    venue_latitude: venueLat,
    venue_longitude: venueLon,
    date: raw.dates.start.localDate,
    ticket_url: raw.url,
    distance_miles: distance,
  }
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function ingestEvents(
  events: TicketmasterEvent[],
  seen: Set<string>,
  allEvents: Event[],
  userLat: number,
  userLon: number
) {
  for (const raw of events) {
    const venue = raw._embedded?.venues?.[0]
    const key = [
      raw.name.toLowerCase().trim(),
      (venue?.name ?? '').toLowerCase().trim(),
      raw.dates.start.localDate,
    ].join('|')

    if (!seen.has(key)) {
      seen.add(key)
      allEvents.push(mapEvent(raw, userLat, userLon))
    }
  }
}

export async function fetchJamEvents(params: FetchEventsParams): Promise<Event[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey) {
    console.warn('TICKETMASTER_API_KEY not set — skipping Ticketmaster fetch')
    return []
  }

  const startDateTime = `${params.startDate}T00:00:00Z`
  const endDateTime = `${params.endDate}T23:59:59Z`
  const latlong = `${params.latitude},${params.longitude}`
  const baseGeo = {
    latlong,
    radius: String(params.radius),
    unit: 'miles',
    startDateTime,
    endDateTime,
    size: '50',
    sort: 'date,asc',
    apikey: apiKey,
  }

  // Deduplicate by band+venue+date across both search strategies.
  const seen = new Set<string>()
  const allEvents: Event[] = []

  await Promise.all([
    // ── Strategy 1: keyword searches for known acts and genre terms ───
    ...ALL_KEYWORDS.map(async (keyword) => {
      try {
        const searchParams = new URLSearchParams({
          ...baseGeo,
          keyword,
          classificationName: 'Music',
        })
        const res = await fetch(
          `https://app.ticketmaster.com/discovery/v2/events.json?${searchParams}`,
          { next: { revalidate: 3600 } }
        )
        if (!res.ok) return
        const data: TicketmasterResponse = await res.json()
        ingestEvents(data._embedded?.events ?? [], seen, allEvents, params.latitude, params.longitude)
      } catch (err) {
        console.warn(`[Ticketmaster] keyword "${keyword}" failed:`, err)
      }
    }),

    // ── Strategy 2: genre classification searches ─────────────────────
    // Uses Ticketmaster's taxonomy — finds events tagged by genre even if
    // the genre word never appears in the event title or description.
    ...GENRE_CLASSIFICATIONS.map(async (genre) => {
      try {
        const searchParams = new URLSearchParams({
          ...baseGeo,
          classificationName: genre,
        })
        const res = await fetch(
          `https://app.ticketmaster.com/discovery/v2/events.json?${searchParams}`,
          { next: { revalidate: 3600 } }
        )
        if (!res.ok) return
        const data: TicketmasterResponse = await res.json()
        ingestEvents(data._embedded?.events ?? [], seen, allEvents, params.latitude, params.longitude)
      } catch (err) {
        console.warn(`[Ticketmaster] genre "${genre}" failed:`, err)
      }
    }),
  ])

  return allEvents.sort((a, b) => {
    if (a.date < b.date) return -1
    if (a.date > b.date) return 1
    return (a.distance_miles ?? 999) - (b.distance_miles ?? 999)
  })
}
