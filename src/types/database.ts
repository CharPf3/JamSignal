export type Band = {
  id: string
  name: string
  slug: string
  confidence_score: number | null
  ai_explanation: string | null
  genre_tags: string[]
  setlist_gd_songs: string[]
  setlist_gd_count: number
  spotify_id: string | null
  bandsintown_id: string | null
  last_analyzed_at: string | null
  created_at: string
  updated_at: string
}

export type Venue = {
  id: string
  name: string
  city: string
  state: string | null
  country: string
  latitude: number | null
  longitude: number | null
  is_jam_friendly: boolean
  jam_friendly_score: number | null
  ticketmaster_id: string | null
  created_at: string
  updated_at: string
}

export type RecurringNight = {
  id: string
  venue_id: string
  name: string
  description: string | null
  day_of_week: number | null
  frequency: 'weekly' | 'biweekly' | 'monthly'
  is_active: boolean
  created_at: string
  venue?: Venue
}

export type Subscription = {
  id: string
  email: string
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  radius_miles: number
  min_confidence: number
  frequency: 'weekly' | 'immediate'
  is_active: boolean
  unsubscribe_token: string
  created_at: string
  updated_at: string
}

export type CommunitySubmission = {
  id: string
  band_name: string
  venue_name: string
  city: string
  state: string | null
  event_date: string
  event_url: string | null
  submitted_by_email: string | null
  notes: string | null
  is_approved: boolean
  reviewed_at: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      bands: { Row: Band; Insert: Omit<Band, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Band, 'id' | 'created_at'>> }
      venues: { Row: Venue; Insert: Omit<Venue, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Venue, 'id' | 'created_at'>> }
      recurring_nights: { Row: RecurringNight; Insert: Omit<RecurringNight, 'id' | 'created_at' | 'venue'>; Update: Partial<Omit<RecurringNight, 'id' | 'created_at' | 'venue'>> }
      subscriptions: { Row: Subscription; Insert: Omit<Subscription, 'id' | 'unsubscribe_token' | 'created_at' | 'updated_at'>; Update: Partial<Omit<Subscription, 'id' | 'created_at'>> }
      community_submissions: { Row: CommunitySubmission; Insert: Omit<CommunitySubmission, 'id' | 'is_approved' | 'reviewed_at' | 'created_at'>; Update: Partial<Omit<CommunitySubmission, 'id' | 'created_at'>> }
    }
  }
}
