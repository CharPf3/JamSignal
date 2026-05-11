export type { Band, Venue, RecurringNight, Subscription, CommunitySubmission, Database } from './database'

// A live event from an external source (Ticketmaster, Bandsintown, etc.)
// Not stored in DB — fetched fresh each search.
export type EventSource = 'ticketmaster' | 'bandsintown' | 'jambase' | 'community'

export type Event = {
  id: string                    // external ID from source
  source: EventSource
  band_name: string
  venue_name: string
  venue_city: string
  venue_state: string | null
  venue_latitude: number | null
  venue_longitude: number | null
  date: string                  // ISO date string
  ticket_url: string | null
  distance_miles: number | null // populated after geo-calculation
  band?: import('./database').Band  // populated if band is in our DB
}

// The enriched result we show to users
export type EventResult = Event & {
  confidence_score: number | null
  ai_explanation: string | null
  genre_tags: string[]
  setlist_gd_songs: string[]
}

export type SearchParams = {
  location: string       // city, state or zip code input
  latitude: number
  longitude: number
  radius_miles: number
  min_confidence: number
  start_date: string
  end_date: string
}

export type GeocodedLocation = {
  display_name: string
  city: string
  state: string | null
  latitude: number
  longitude: number
}
