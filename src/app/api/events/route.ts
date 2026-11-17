import { NextResponse, type NextRequest } from 'next/server'
import { search } from '@/lib/pipeline'

/**
 * A warm search is a geocode plus Ticketmaster queries plus one batched cache
 * read. A cold one also analyses up to the artist budget. 60s is headroom, not
 * a target; the old pipeline exceeded 120s and returned nothing.
 */
export const maxDuration = 60

const int = (value: string | null, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  const result = await search({
    location: params.get('location') ?? '',
    radiusMiles: int(params.get('radius'), 50),
    days: int(params.get('days'), 60),
    minScore: params.has('minScore') ? Number(params.get('minScore')) : undefined,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { diagnostics } = result.data
  console.log(
    `[search] ${result.data.location.label} ${result.data.radius}mi/${result.data.days}d — ` +
    `${diagnostics.raw_events} events, ${diagnostics.unique_artists} artists ` +
    `(${diagnostics.cached_artists} cached, ${diagnostics.analyzed_now} analysed, ${diagnostics.pending_artists} pending) ` +
    `-> ${diagnostics.surfaced} surfaced in ${diagnostics.elapsed_ms}ms` +
    (diagnostics.queries_failed > 0 ? ` [${diagnostics.queries_failed}/${diagnostics.queries_issued} queries failed]` : '') +
    (diagnostics.missing_config.length > 0 ? ` [missing: ${diagnostics.missing_config.join(', ')}]` : '')
  )

  return NextResponse.json(result.data, {
    headers: {
      // The artist index makes repeated searches cheap; this keeps the browser
      // and CDN from re-running them at all within the window.
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
    },
  })
}
