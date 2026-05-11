import { NextRequest, NextResponse } from 'next/server'
import { geocodeLocation } from '@/lib/geocoding'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 })
  }

  const result = await geocodeLocation(query.trim())

  if (!result) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}
