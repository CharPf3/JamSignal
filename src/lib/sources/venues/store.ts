/**
 * Persistence for cached venue calendars.
 *
 * Separate from `artists/cache.ts` because the two store different kinds of
 * thing. Artist analysis is expensive and effectively permanent — a band's
 * Last.fm neighbourhood does not move between searches. A venue's calendar
 * changes constantly, so this is a cache with a TTL and the reader enforces it.
 *
 * Same failure discipline as the artist index, for the same reason: the first
 * one failed silently and completely because every read swallowed its error and
 * returned null. Reads here report their state instead, and the pipeline
 * surfaces it in diagnostics.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/core/env'
import type { VenueEvent } from './jsonld'

/**
 * How long a venue's ingested calendar is trusted.
 *
 * Shorter than the artist index's 30 days by two orders of magnitude, because
 * a calendar is a claim about the near future rather than a fact about a band.
 * A week means a daily ingestion can miss six runs before the app starts
 * treating a venue as unknown rather than quietly serving last month's shows.
 */
const TTL_DAYS = 7

let client: SupabaseClient | null = null
let lastError: string | null = null

function getClient(): SupabaseClient | null {
  const url = env.supabaseUrl()
  const key = env.supabaseServiceKey()
  if (!url || !key) return null
  if (!client) client = createClient(url, key, { auth: { persistSession: false } })
  return client
}

export type VenueStoreState = 'unconfigured' | 'ok' | 'unavailable'

export function venueStoreState(): { state: VenueStoreState; error: string | null } {
  if (getClient() === null) return { state: 'unconfigured', error: 'Supabase env vars not set' }
  if (lastError) return { state: 'unavailable', error: lastError }
  return { state: 'ok', error: null }
}

export type StoredVenueEvent = {
  url: string
  venue_key: string
  title: string
  event_date: string
  start_time: string | null
  ticket_url: string | null
}

/**
 * Reads cached events for the given venues within a date window.
 *
 * Takes venue keys rather than coordinates: distance filtering happens against
 * the registry in code, which is cheaper and keeps venue geography versioned
 * with the source rather than duplicated per row.
 */
export async function readVenueEvents(args: {
  venueKeys: string[]
  startDate: string
  endDate: string
}): Promise<StoredVenueEvent[]> {
  if (args.venueKeys.length === 0) return []
  const db = getClient()
  if (!db) return []

  const cutoff = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('venue_events')
    .select('url, venue_key, title, event_date, start_time, ticket_url')
    .in('venue_key', args.venueKeys)
    .gte('event_date', args.startDate)
    .lte('event_date', args.endDate)
    .gte('ingested_at', cutoff)
    .order('event_date', { ascending: true })

  if (error) {
    lastError = error.message
    console.warn(`[venue-store] read failed: ${error.message}`)
    return []
  }

  lastError = null
  return (data ?? []) as StoredVenueEvent[]
}

/**
 * Replaces a venue's cached calendar.
 *
 * Delete-then-insert rather than upsert, because a show that has been cancelled
 * disappears from the feed and an upsert would leave it in the cache until its
 * row expired — advertising a cancelled show for up to a week. The two
 * statements are not transactional; a failure between them leaves the venue
 * with no cached events, which the reader treats as "not ingested" and is the
 * safe direction to fail.
 */
export async function replaceVenueEvents(
  venueKey: string,
  events: VenueEvent[]
): Promise<{ written: number; error: string | null }> {
  const db = getClient()
  if (!db) return { written: 0, error: 'Supabase env vars not set' }

  const { error: deleteError } = await db.from('venue_events').delete().eq('venue_key', venueKey)
  if (deleteError) {
    lastError = deleteError.message
    return { written: 0, error: deleteError.message }
  }

  if (events.length === 0) return { written: 0, error: null }

  const now = new Date().toISOString()
  const { error: insertError } = await db.from('venue_events').insert(
    events.map((e) => ({
      url: e.url,
      venue_key: venueKey,
      title: e.name,
      event_date: e.date,
      start_time: e.startTime,
      ticket_url: e.ticketUrl,
      ingested_at: now,
    }))
  )

  if (insertError) {
    lastError = insertError.message
    return { written: 0, error: insertError.message }
  }

  lastError = null
  return { written: events.length, error: null }
}
