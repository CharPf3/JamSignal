import { NextRequest, NextResponse } from 'next/server'
import { getLastFmData } from '@/lib/lastfm/client'

export async function GET(request: NextRequest) {
  const band = request.nextUrl.searchParams.get('band') ?? 'Marcus King'
  const result = await getLastFmData(band)
  return NextResponse.json({ band, result })
}
