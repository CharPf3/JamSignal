export type { Band, Venue, RecurringNight, Subscription, CommunitySubmission, Database } from './database'

/** Where an event came from. */
export type EventSource = 'ticketmaster' | 'bandsintown' | 'jambase' | 'community'

/**
 * A live event as returned by an upstream source. Not persisted — events are
 * fetched per search, unlike artist analysis, which is cached.
 */
export type Event = {
  id: string
  source: EventSource
  /** The listing title as published, e.g. "Goose - Summer Tour 2026". */
  event_title: string
  /** Canonical performer name, used for music-database lookups. */
  artist_name: string
  venue_name: string
  venue_city: string
  venue_state: string | null
  venue_latitude: number | null
  venue_longitude: number | null
  /** Local date, YYYY-MM-DD. */
  date: string
  /** Local start time, HH:MM:SS, when published. */
  start_time: string | null
  ticket_url: string | null
  distance_miles: number | null
  /** Retained for display only — not used in scoring. See scoring/weights.ts. */
  tm_genre: string | null
  tm_subgenre: string | null
}

/** How an artist's jam score was arrived at, for display and debugging. */
export type ScoreSignal = {
  key: string
  label: string
  points: number
  max: number
  detail: string | null
}

/** An event plus the analysis of who is playing it. */
export type EventResult = Event & {
  score: number
  score_label: string
  /** Plain-language statements of the evidence found. */
  reasons: string[]
  /** Per-signal contributions; sums to the score. */
  signals: ScoreSignal[]
  /** Canon songs seen in recent setlists. */
  notable_songs: string[]
  /** setlist.fm artist page, required when setlist data is shown. */
  attribution_url: string | null
  /** Several artists share this name, so genre data may be unreliable. */
  name_ambiguous: boolean
  /** Analysis is still queued — shown as pending rather than scored low. */
  pending: boolean
}

/** A group of events by the same artist, which is how results are presented. */
export type ArtistGroup = {
  artist_name: string
  score: number
  score_label: string
  reasons: string[]
  signals: ScoreSignal[]
  notable_songs: string[]
  attribution_url: string | null
  name_ambiguous: boolean
  pending: boolean
  events: Event[]
}

export type GeocodedLocation = {
  /** Full name from the geocoder, e.g. "Madison, Dane County, Wisconsin". */
  display_name: string
  /** Short label for the UI, e.g. "Madison, WI". */
  label: string
  city: string
  state: string | null
  state_code: string | null
  latitude: number
  longitude: number
}

/** Diagnostics returned with every search, so coverage gaps are visible. */
export type SearchDiagnostics = {
  raw_events: number
  unique_artists: number
  cached_artists: number
  analyzed_now: number
  pending_artists: number
  surfaced: number
  /** False when a Ticketmaster query failed, meaning results may be partial. */
  complete: boolean
  queries_issued: number
  queries_failed: number
  /** Services that could not run because configuration is missing. */
  missing_config: string[]
  elapsed_ms: number
}

export type SearchResponse = {
  location: GeocodedLocation
  radius: number
  days: number
  groups: ArtistGroup[]
  /**
   * Artists just below the confidence threshold. Shown separately and labelled
   * as weaker rather than mixed in — see DISPLAY_THRESHOLD in scoring/weights.
   */
  marginal: ArtistGroup[]
  total_events: number
  diagnostics: SearchDiagnostics
}
