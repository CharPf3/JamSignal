import { NextResponse, type NextRequest } from 'next/server'
import { touchCache } from '@/lib/artists/cache'
import { env } from '@/lib/core/env'

/**
 * Keeps the artist index alive.
 *
 * Supabase pauses a free project after about a week of inactivity and
 * eventually deletes it. That is not a hypothetical: the project's first index
 * was reaped, `ujozjsvhuwgejlxetrwa.supabase.co` stopped resolving, and because
 * every cache read swallowed its error the app silently went back to analysing
 * every artist on every request. The index is the thing that makes a search
 * fast and complete, so losing it costs roughly half the results — a Denver
 * search returns 14 artists on a cold index against 31 on a warm one.
 *
 * One read a day resets the idle clock. The response reports row count and the
 * oldest entry, so a glance at the cron log distinguishes "reachable" from
 * "reachable and actually populated".
 *
 * Scheduled in vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * when that variable is set; the check is skipped when it is not, so the route
 * still works on a local or unconfigured deploy.
 */
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!env.supabaseUrl() || !env.supabaseServiceKey()) {
    // Not an error: the app is designed to run without the index, so a missing
    // configuration is a state to report rather than a failure to alarm on.
    return NextResponse.json(
      { ok: false, configured: false, note: 'Supabase env vars not set; nothing to keep warm.' },
      { status: 200 }
    )
  }

  const result = await touchCache()

  return NextResponse.json(
    {
      ok: result.ok,
      configured: true,
      rows: result.rows,
      oldest_entry: result.oldest,
      error: result.error,
      checked_at: new Date().toISOString(),
    },
    { status: result.ok ? 200 : 503 }
  )
}
