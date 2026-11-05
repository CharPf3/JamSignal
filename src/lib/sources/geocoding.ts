/**
 * Location resolution.
 *
 * The previous implementation asked Nominatim for five results and picked the
 * first one that happened to carry a city or town field. That is a guess, not a
 * ranking, and it offered the user no way to correct it: one free-text box, one
 * silent interpretation, no feedback about what was actually searched.
 *
 * Two changes. Resolution now ranks candidates explicitly — exact-ish name
 * match, then place importance, then type — and `suggestLocations` returns the
 * ranked list so the UI can offer real choices as the user types instead of
 * committing to a guess.
 */

import { USER_AGENT } from '@/lib/core/env'
import { fetchJson } from '@/lib/core/http'
import { throttle } from '@/lib/core/concurrency'
import { normalize } from '@/lib/canon/normalize'
import type { GeocodedLocation } from '@/types'

type NominatimResult = {
  lat: string
  lon: string
  display_name: string
  name?: string
  importance?: number
  addresstype?: string
  type?: string
  class?: string
  address?: {
    city?: string
    town?: string
    village?: string
    hamlet?: string
    municipality?: string
    county?: string
    state?: string
    'ISO3166-2-lvl4'?: string
    postcode?: string
  }
}

/** Nominatim's usage policy allows one request per second. */
const limit = throttle(1)

/** Place types worth surfacing, best first. Used as a ranking term. */
const TYPE_RANK: Record<string, number> = {
  city: 5,
  town: 4,
  village: 3,
  municipality: 3,
  postcode: 3,
  hamlet: 2,
  suburb: 2,
  county: 1,
  state: 1,
}

const STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
}

function stateCodeOf(result: NominatimResult): string | null {
  const iso = result.address?.['ISO3166-2-lvl4']
  if (iso?.startsWith('US-')) return iso.slice(3)
  const state = result.address?.state?.toLowerCase()
  return state ? (STATE_CODES[state] ?? null) : null
}

function cityOf(result: NominatimResult, fallback: string): string {
  const a = result.address
  return a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? a?.hamlet ?? a?.county ?? result.name ?? fallback
}

function toLocation(result: NominatimResult, query: string): GeocodedLocation {
  const city = cityOf(result, query)
  const code = stateCodeOf(result)
  return {
    display_name: result.display_name,
    label: code ? `${city}, ${code}` : city,
    city,
    state: result.address?.state ?? null,
    state_code: code,
    latitude: Number.parseFloat(result.lat),
    longitude: Number.parseFloat(result.lon),
  }
}

/**
 * Ranks a candidate against the query.
 *
 * Nominatim orders by its own relevance, which conflates place prominence with
 * name match — searching "Madison" can surface Madison County ahead of the city
 * of Madison. Name match is weighted first, then place type, then importance.
 */
function rank(result: NominatimResult, query: string): number {
  const q = normalize(query)
  const name = normalize(result.name ?? '')
  const city = normalize(cityOf(result, ''))

  let score = 0
  if (name === q || city === q) score += 100
  else if (name.startsWith(q) || city.startsWith(q)) score += 50
  else if (name.includes(q) || city.includes(q)) score += 20

  score += (TYPE_RANK[result.addresstype ?? ''] ?? TYPE_RANK[result.type ?? ''] ?? 0) * 6
  score += (result.importance ?? 0) * 10
  return score
}

async function search(query: string, limitCount: number): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limitCount),
    countrycodes: 'us',
  })

  const results = await limit(() =>
    fetchJson<NominatimResult[]>(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      revalidate: 60 * 60 * 24 * 30,
    })
  ).catch(() => null)

  return results ?? []
}

/** Resolves a free-text location to a single best match, or null. */
export async function geocodeLocation(query: string): Promise<GeocodedLocation | null> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return null

  const results = await search(trimmed, 8)
  if (results.length === 0) return null

  const best = [...results].sort((a, b) => rank(b, trimmed) - rank(a, trimmed))[0]!
  return toLocation(best, trimmed)
}

/**
 * Returns ranked location candidates for autocomplete.
 *
 * Deduplicated by coordinate, because Nominatim often returns the same place as
 * several administrative entries.
 */
export async function suggestLocations(query: string, max = 5): Promise<GeocodedLocation[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []

  const results = await search(trimmed, 10)
  const seen = new Set<string>()
  const out: GeocodedLocation[] = []

  for (const result of [...results].sort((a, b) => rank(b, trimmed) - rank(a, trimmed))) {
    const location = toLocation(result, trimmed)
    const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(location)
    if (out.length >= max) break
  }

  return out
}

/** Reverse geocode, for the browser's "use my location" control. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodedLocation | null> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '10',
  })

  const result = await limit(() =>
    fetchJson<NominatimResult>(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      revalidate: 60 * 60 * 24 * 30,
    })
  ).catch(() => null)

  return result ? toLocation(result, 'your location') : null
}
