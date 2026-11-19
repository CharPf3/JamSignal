/**
 * Reads a venue's events RSS feed for the list of event-page URLs.
 *
 * The feed is the index, not the data. WordPress event feeds carry a title, a
 * link and a `pubDate` — and `pubDate` is when the *listing* was published, not
 * when the show is. Cervantes' feed showed "2 hours ago" against a show in May
 * 2027, so taking it for the event date would be badly wrong rather than
 * slightly wrong. Dates come from the event pages (see jsonld.ts).
 *
 * The listing page was tried first and rejected: it holds all 114 events but
 * their dates appear only as bare "Nov 19" text near a link, with no year and
 * absent entirely for some entries. Parsing that would be guesswork dressed as
 * data.
 *
 * Parsed with regex rather than an XML library on purpose — the only fields
 * needed are `link`, `title` and `lastBuildDate`, and adding a parser
 * dependency to read three tags is not worth the install.
 */

export type FeedEntry = { url: string; title: string }

export type ParsedFeed = {
  entries: FeedEntry[]
  /** The feed's own claim about when it was generated, when it makes one. */
  lastBuild: Date | null
}

const decodeEntities = (text: string): string =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)
  return match ? decodeEntities(match[1]!) : null
}

export function parseFeed(xml: string, eventUrlPattern: RegExp): ParsedFeed {
  // Scope the build date to the channel header: an <item> may also carry dates,
  // and matching the first occurrence anywhere would pick up whichever came
  // first in the document.
  const header = xml.slice(0, xml.indexOf('<item>') === -1 ? xml.length : xml.indexOf('<item>'))
  const rawBuild = tag(header, 'lastBuildDate') ?? tag(header, 'pubDate')
  const parsedBuild = rawBuild ? new Date(rawBuild) : null
  const lastBuild = parsedBuild && !Number.isNaN(parsedBuild.getTime()) ? parsedBuild : null

  const entries: FeedEntry[] = []
  const seen = new Set<string>()

  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1]!
    const url = tag(block, 'link')
    if (!url || !eventUrlPattern.test(url)) continue

    // A venue's feed repeats an event when the listing is edited.
    const canonical = url.replace(/\/+$/, '')
    if (seen.has(canonical)) continue
    seen.add(canonical)

    entries.push({ url: canonical, title: tag(block, 'title') ?? '' })
  }

  return { entries, lastBuild }
}

/** Matches a WordPress event permalink, e.g. /event/twiddle/venue/city-state/. */
export const WORDPRESS_EVENT_URL = /\/event\//
