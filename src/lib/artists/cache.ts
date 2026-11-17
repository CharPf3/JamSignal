/**
 * Persistence for the artist index.
 *
 * The previous cache failed silently and completely. Its Supabase project had
 * been deleted — `ujozjsvhuwgejlxetrwa.supabase.co` does not resolve — and
 * because every read swallowed its error and returned null, the app reported
 * `cache_hits: 0` on two consecutive identical searches while paying full API
 * cost on both and adding a failed DNS lookup per artist per request.
 *
 * Two defences against that recurring:
 *
 *   1. A circuit breaker. After a few consecutive failures the cache is marked
 *      unavailable and skipped for the rest of the request, so a dead backend
 *      costs one round trip instead of two per artist.
 *
 *   2. `cacheStatus()`, reported in the search diagnostics. A broken cache is
 *      now visible rather than merely slow.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/core/env'
import type { ArtistAnalysis } from './index'

/** Rows older than this are re-analysed on next lookup. */
const TTL_DAYS = 30

/** Consecutive failures before the cache is treated as unavailable. */
const FAILURE_THRESHOLD = 3

type CacheState = 'unconfigured' | 'ok' | 'degraded' | 'unavailable'

let client: SupabaseClient | null = null
let failures = 0
let lastError: string | null = null

function getClient(): SupabaseClient | null {
  const url = env.supabaseUrl()
  const key = env.supabaseServiceKey()
  if (!url || !key) return null
  if (!client) client = createClient(url, key, { auth: { persistSession: false } })
  return client
}

/** Whether the cache is usable right now. */
function available(): boolean {
  return getClient() !== null && failures < FAILURE_THRESHOLD
}

export function cacheStatus(): { state: CacheState; error: string | null } {
  if (getClient() === null) return { state: 'unconfigured', error: 'Supabase env vars not set' }
  if (failures >= FAILURE_THRESHOLD) return { state: 'unavailable', error: lastError }
  if (failures > 0) return { state: 'degraded', error: lastError }
  return { state: 'ok', error: null }
}

/** Resets the breaker. Called once per request so a transient fault recovers. */
export function resetCacheBreaker(): void {
  failures = 0
  lastError = null
}

function noteFailure(message: string): void {
  failures++
  lastError = message
  if (failures === FAILURE_THRESHOLD) {
    console.warn(`[artist-cache] disabled after ${FAILURE_THRESHOLD} consecutive failures: ${message}`)
  }
}

/** Shape of the artist_index table. See supabase/migrations. */
type Row = {
  artist_key: string
  artist_name: string
  mbid: string | null
  analysis: ArtistAnalysis
  analyzed_at: string
}

/**
 * Reads many artists in one query.
 *
 * Batched deliberately: the old code issued one request per artist, so a
 * 40-artist search made 40 round trips before touching a music API.
 */
export async function readArtists(keys: string[]): Promise<Map<string, ArtistAnalysis>> {
  const found = new Map<string, ArtistAnalysis>()
  if (keys.length === 0 || !available()) return found

  const db = getClient()!
  const cutoff = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('artist_index')
    .select('artist_key, artist_name, mbid, analysis, analyzed_at')
    .in('artist_key', keys)
    .gte('analyzed_at', cutoff)

  if (error) {
    noteFailure(error.message)
    return found
  }

  failures = 0
  for (const row of (data ?? []) as Row[]) {
    if (row.analysis) found.set(row.artist_key, row.analysis)
  }
  return found
}

/**
 * Cheap liveness touch, for the scheduled keep-warm.
 *
 * Supabase pauses a free project after a week idle and eventually deletes it;
 * that is how the first index was lost. A read once a day costs nothing and
 * resets the idle clock. The row count and oldest entry come back with it, so
 * the cron's own response says whether the index is actually populated rather
 * than merely reachable.
 */
export async function touchCache(): Promise<{
  ok: boolean
  rows: number | null
  oldest: string | null
  error: string | null
}> {
  const db = getClient()
  if (!db) return { ok: false, rows: null, oldest: null, error: 'Supabase env vars not set' }

  const { data, count, error } = await db
    .from('artist_index')
    .select('analyzed_at', { count: 'exact' })
    .order('analyzed_at', { ascending: true })
    .limit(1)

  if (error) {
    noteFailure(error.message)
    return { ok: false, rows: null, oldest: null, error: error.message }
  }

  failures = 0
  return {
    ok: true,
    rows: count ?? 0,
    oldest: (data as Array<{ analyzed_at: string }> | null)?.[0]?.analyzed_at ?? null,
    error: null,
  }
}

/** Writes analyses in one statement. Failures are logged, never thrown. */
export async function writeArtists(
  entries: Array<{ key: string; name: string; mbid: string | null; analysis: ArtistAnalysis }>
): Promise<void> {
  if (entries.length === 0 || !available()) return

  const db = getClient()!
  const now = new Date().toISOString()

  const { error } = await db.from('artist_index').upsert(
    entries.map((e) => ({
      artist_key: e.key,
      artist_name: e.name,
      mbid: e.mbid,
      analysis: e.analysis,
      analyzed_at: now,
    })),
    { onConflict: 'artist_key' }
  )

  if (error) noteFailure(error.message)
  else failures = 0
}
