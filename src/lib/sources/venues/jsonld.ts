/**
 * Extracts a schema.org `Event` from a venue's event page.
 *
 * This is the one piece of venue ingestion that is not guesswork. The page
 * publishes its own event as structured data, so the date, name and ticket link
 * are read rather than inferred:
 *
 *   {"@type":"Event","name":"Twiddle",
 *    "startDate":"2027-05-07T20:00:00-0600",
 *    "location":"Cervantes' Masterpiece Ballroom",
 *    "offers":{"@type":"Offer","url":"https://www.etix.com/ticket/p/55575657/..."}}
 *
 * JSON-LD nests unpredictably — `@graph` arrays, arrays of nodes, events inside
 * `subEvent` — so the search walks the whole tree instead of assuming a shape.
 * A page with no Event node returns null and is skipped, which is the right
 * outcome: a venue page that does not say when its show is cannot be used.
 */

export type VenueEvent = {
  /** Event page URL, used as the stable identity. */
  url: string
  name: string
  /** ISO 8601, as published, including the venue's offset. */
  startDate: string
  /** Local date, YYYY-MM-DD, taken from the published offset. */
  date: string
  /** Local time HH:MM:SS, when the page states one. */
  startTime: string | null
  ticketUrl: string | null
  /**
   * The venue the page names, when it names one.
   *
   * Load-bearing, not decorative. A venue's feed promotes shows it books
   * elsewhere: eleven of Cervantes' 108 listings are at Red Rocks, the Ogden,
   * Mission Ballroom, Bluebird, Fiddler's Green or WinterWonderGrass in
   * Steamboat Springs — the last about 150 miles away. Ingesting those under
   * the registered venue would give them its address and its distance.
   */
  locationName: string | null
}

const decode = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c: string) => String.fromCharCode(Number.parseInt(c, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

/** Every JSON-LD node on the page, flattened. */
function nodes(html: string): unknown[] {
  const out: unknown[] = []
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1]!.trim())
    } catch {
      // A malformed block on one page should not discard the others.
      continue
    }
    const stack = [parsed]
    while (stack.length > 0) {
      const node = stack.pop()
      if (Array.isArray(node)) {
        stack.push(...node)
        continue
      }
      if (node === null || typeof node !== 'object') continue
      out.push(node)
      for (const value of Object.values(node as Record<string, unknown>)) {
        if (value !== null && typeof value === 'object') stack.push(value)
      }
    }
  }
  return out
}

const isEvent = (node: Record<string, unknown>): boolean => {
  const type = node['@type']
  const types = Array.isArray(type) ? type : [type]
  // Covers Event and its subtypes — MusicEvent, Festival, TheaterEvent.
  return types.some((t) => typeof t === 'string' && /Event$/.test(t))
}

/** schema.org allows `location` as a Place object or a bare string. */
function locationName(node: Record<string, unknown>): string | null {
  const location = node['location']
  if (typeof location === 'string') return decode(location)
  if (location !== null && typeof location === 'object') {
    const name = (location as Record<string, unknown>)['name']
    if (typeof name === 'string') return decode(name)
  }
  return null
}

function offerUrl(node: Record<string, unknown>): string | null {
  const offers = node['offers']
  const list = Array.isArray(offers) ? offers : [offers]
  for (const offer of list) {
    if (offer !== null && typeof offer === 'object') {
      const url = (offer as Record<string, unknown>)['url']
      if (typeof url === 'string' && url.startsWith('http')) return url
    }
  }
  return null
}

/**
 * Splits an ISO timestamp into the local date and time it denotes.
 *
 * Deliberately string-based. `new Date(...).toISOString()` would convert to UTC
 * and silently move a 8pm show on the 7th to the 8th for any venue west of
 * Greenwich — which is every venue this app covers.
 */
function localParts(startDate: string): { date: string; startTime: string | null } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?))?/.exec(startDate.trim())
  if (!match) return null
  const time = match[2] ? (match[2].length === 5 ? `${match[2]}:00` : match[2]) : null
  return { date: match[1]!, startTime: time }
}

/** Reads the event a page describes, or null when it does not describe one. */
export function extractEvent(html: string, url: string): VenueEvent | null {
  for (const node of nodes(html)) {
    const record = node as Record<string, unknown>
    if (typeof record !== 'object' || record === null || !isEvent(record)) continue

    const startDate = record['startDate']
    const name = record['name']
    if (typeof startDate !== 'string' || typeof name !== 'string') continue

    const parts = localParts(startDate)
    if (!parts) continue

    return {
      url,
      name: decode(name),
      startDate,
      date: parts.date,
      startTime: parts.startTime,
      ticketUrl: offerUrl(record),
      locationName: locationName(record),
    }
  }
  return null
}
