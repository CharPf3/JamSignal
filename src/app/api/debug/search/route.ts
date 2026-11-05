import { NextResponse, type NextRequest } from 'next/server'
import { search } from '@/lib/pipeline'
import { cacheStatus } from '@/lib/artists/cache'
import { analyzeArtist } from '@/lib/artists'

/**
 * Debug endpoint.
 *
 * Calls the same `search` as the public route — the previous version duplicated
 * the whole pipeline, so the thing used for debugging was not the thing being
 * debugged. This only differs in showing filtered groups and per-signal
 * breakdowns alongside the results.
 *
 *   /api/debug/search?location=Madison,WI&radius=50
 *   /api/debug/search?artist=Armchair+Boogie
 */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // Single-artist mode replaces the old /api/test-spotify and /api/test-setlist.
  const artist = params.get('artist')
  if (artist) {
    return NextResponse.json({ artist, analysis: await analyzeArtist(artist) })
  }

  const result = await search({
    location: params.get('location') ?? 'Madison, WI',
    radiusMiles: Number.parseInt(params.get('radius') ?? '50', 10),
    days: Number.parseInt(params.get('days') ?? '60', 10),
    includeFiltered: true,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const summarize = (groups: typeof result.data.groups) =>
    groups.map((g) => ({
      artist: g.artist_name,
      score: g.score,
      label: g.score_label,
      pending: g.pending,
      ambiguous: g.name_ambiguous,
      shows: g.events.length,
      signals: g.signals.map((s) => `${s.key}=${Math.round(s.weight * 100)}%`),
      reasons: g.reasons,
    }))

  const surfacedNames = new Set(
    result.data.groups.filter((g) => !g.pending && g.score >= 2.5).map((g) => g.artist_name)
  )

  return NextResponse.json({
    location: result.data.location,
    diagnostics: result.data.diagnostics,
    cache: cacheStatus(),
    surfaced: summarize(result.data.groups.filter((g) => surfacedNames.has(g.artist_name))),
    filtered: summarize(result.filtered),
  })
}
