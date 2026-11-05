import { NextResponse, type NextRequest } from 'next/server'
import { suggestLocations, reverseGeocode } from '@/lib/sources/geocoding'

/**
 * Location autocomplete and reverse geocoding.
 *
 * Replaces `/api/geocode`, which resolved a query to a single silent guess and
 * which the UI never called. Returning ranked candidates lets the search box
 * show the user what it is about to search instead of committing on their
 * behalf.
 */
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  const lat = params.get('lat')
  const lon = params.get('lon')
  if (lat && lon) {
    const latitude = Number.parseFloat(lat)
    const longitude = Number.parseFloat(lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
    }
    const location = await reverseGeocode(latitude, longitude)
    return location
      ? NextResponse.json({ locations: [location] })
      : NextResponse.json({ error: 'Could not identify that location' }, { status: 404 })
  }

  const query = params.get('q')?.trim() ?? ''
  if (query.length < 3) return NextResponse.json({ locations: [] })

  const locations = await suggestLocations(query)
  return NextResponse.json({ locations }, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
  })
}
