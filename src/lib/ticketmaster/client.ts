import type { Event } from '@/types'

// Grateful Dead and jam-band keywords used to find relevant events.
// Searched in OR fashion — any match qualifies for initial results.
const JAM_KEYWORDS = [
  'grateful dead',
  'dead & company',
  'dead and company',
  'dark star orchestra',
  'jerry garcia',
  'phil lesh',
  'bob weir',
  'ratdog',
  'further',
  'terrapin',
  'phish',
  'widespread panic',
  'string cheese incident',
  'govt mule',
  'government mule',
  'allman brothers',
  'tedeschi trucks',
  'umphrees',
  "umphreys mcgee",
  'disco biscuits',
  'moe.',
  'leftover salmon',
  'yonder mountain',
  'railroad earth',
  'greensky bluegrass',
  'billy strings',
  'new riders',
  'hot tuna',
]

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

// Haversine formula — great-circle distance in miles
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8 // Earth radius in miles
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

export async function fetchJamEvents(params: FetchEventsParams): Promise<Event[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey) {
    console.warn('TICKETMASTER_API_KEY not set — skipping Ticketmaster fetch')
    return []
  }

  const startDateTime = `${params.startDate}T00:00:00Z`
  const endDateTime = `${params.endDate}T23:59:59Z`
  const latlong = `${params.latitude},${params.longitude}`

  // Deduplicate by band+venue+date — the same show can appear across
  // multiple keyword searches with different Ticketmaster event IDs.
  const seen = new Set<string>()
  const allEvents: Event[] = []

  await Promise.all(
    JAM_KEYWORDS.map(async (keyword) => {
      try {
        const searchParams = new URLSearchParams({
          apikey: apiKey,
          keyword,
          latlong,
          radius: String(params.radius),
          unit: 'miles',
          classificationName: 'Music',
          startDateTime,
          endDateTime,
          size: '50',
          sort: 'date,asc',
        })

        const res = await fetch(
          `https://app.ticketmaster.com/discovery/v2/events.json?${searchParams}`,
          { next: { revalidate: 3600 } }
        )

        if (!res.ok) return

        const data: TicketmasterResponse = await res.json()
        const events = data._embedded?.events ?? []

        for (const raw of events) {
          const venue = raw._embedded?.venues?.[0]
          const key = [
            raw.name.toLowerCase().trim(),
            (venue?.name ?? '').toLowerCase().trim(),
            raw.dates.start.localDate,
          ].join('|')

          if (!seen.has(key)) {
            seen.add(key)
            allEvents.push(mapEvent(raw, params.latitude, params.longitude))
          }
        }
      } catch {
        // Individual keyword failures shouldn't break the whole request
      }
    })
  )

  return allEvents.sort((a, b) => {
    if (a.date < b.date) return -1
    if (a.date > b.date) return 1
    return (a.distance_miles ?? 999) - (b.distance_miles ?? 999)
  })
}
