import type { GeocodedLocation } from '@/types'

type NominatimResult = {
  lat: string
  lon: string
  display_name: string
  address: {
    city?: string
    town?: string
    village?: string
    county?: string
    state?: string
    postcode?: string
    country_code?: string
  }
}

export async function geocodeLocation(query: string): Promise<GeocodedLocation | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'us',
  })

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: {
      // Nominatim requires a descriptive User-Agent
      'User-Agent': 'JamSignal/1.0 (cmpfenn@gmail.com)',
    },
    next: { revalidate: 86400 }, // cache geocode results for 24h
  })

  if (!res.ok) return null

  const results: NominatimResult[] = await res.json()
  const result = results[0]
  if (!result) return null

  const city =
    result.address.city ??
    result.address.town ??
    result.address.village ??
    result.address.county ??
    query

  return {
    display_name: result.display_name,
    city,
    state: result.address.state ?? null,
    latitude: parseFloat(result.lat),
    longitude: parseFloat(result.lon),
  }
}
