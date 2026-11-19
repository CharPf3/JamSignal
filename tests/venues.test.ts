/**
 * Validates venue calendar ingestion.
 *
 * Every fixture here is the real shape observed while probing six venues on
 * 2026-11-17, because each assertion exists for a specific thing that went
 * wrong or nearly did:
 *
 *   - Cervantes' RSS carries `pubDate` "2 hours ago" against a show in May
 *     2027, so reading the feed's date as the event date would be badly wrong
 *   - Salvage Station serves a syntactically perfect iCal whose newest event is
 *     from 2021, so a valid feed is not a current one
 *   - every venue in range is west of Greenwich, so converting an 8pm start to
 *     UTC moves the show to the next day
 */

import { describe, expect, it } from 'vitest'
import { parseFeed, WORDPRESS_EVENT_URL } from '@/lib/sources/venues/feed'
import { extractEvent } from '@/lib/sources/venues/jsonld'
import { assessFreshness } from '@/lib/sources/venues/freshness'
import { venuesWithin, VENUES } from '@/lib/sources/venues'

// Shape of cervantesmasterpiece.com/events/feed/, trimmed.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Cervantes Masterpiece Ballroom</title>
  <lastBuildDate>Tue, 17 Nov 2026 19:43:31 +0000</lastBuildDate>
  <item>
    <title>Mihali Presents: MihaliDaze</title>
    <link>https://cervantesmasterpiece.com/event/mihali-presents/cervantes/denver-colorado/</link>
    <pubDate>Tue, 17 Nov 2026 17:50:00 +0000</pubDate>
  </item>
  <item>
    <title>Isaiah Collier &#8216;Joy&#8217; &#038; Brandee Younger</title>
    <link>https://cervantesmasterpiece.com/event/isaiah-collier/cervantes/denver-colorado/</link>
    <pubDate>Mon, 16 Nov 2026 12:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Duplicate listing, edited</title>
    <link>https://cervantesmasterpiece.com/event/mihali-presents/cervantes/denver-colorado</link>
    <pubDate>Mon, 16 Nov 2026 12:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Not an event page</title>
    <link>https://cervantesmasterpiece.com/about/</link>
    <pubDate>Mon, 16 Nov 2026 12:00:00 +0000</pubDate>
  </item>
</channel></rss>`

describe('the feed is an index of event pages, not of events', () => {
  const parsed = parseFeed(FEED, WORDPRESS_EVENT_URL)

  it('keeps only event permalinks', () => {
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries.every((e) => e.url.includes('/event/'))).toBe(true)
  })

  it('collapses the same event listed twice', () => {
    // A venue's feed repeats an event when the listing is edited, and the two
    // copies differ only by a trailing slash.
    const mihali = parsed.entries.filter((e) => e.url.includes('mihali'))
    expect(mihali).toHaveLength(1)
  })

  it('decodes entities in the billing', () => {
    // Faithfully, including the curly quotes WordPress emits as &#8216;/&#8217;
    // — normalizeName strips them when the name reaches the music databases,
    // so the feed layer has no business guessing at punctuation.
    const collier = parsed.entries.find((e) => e.url.includes('isaiah'))
    expect(collier?.title).toBe('Isaiah Collier ‘Joy’ & Brandee Younger')
  })

  it('reads the build date from the channel, not from an item', () => {
    // Items carry pubDate too; matching the first date anywhere would take
    // whichever appeared first in the document.
    expect(parsed.lastBuild?.toISOString()).toBe('2026-11-17T19:43:31.000Z')
  })

  it('tolerates a feed with no build date', () => {
    expect(parseFeed('<rss><channel><title>x</title></channel></rss>', WORDPRESS_EVENT_URL).lastBuild).toBeNull()
  })
})

// Shape of a Cervantes event page's JSON-LD, as observed.
const EVENT_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Place","@id":"https://cervantesmasterpiece.com/#place"},
  {"@type":"Event","name":"Twiddle","startDate":"2027-05-07T20:00:00-0600",
   "url":"https://cervantesmasterpiece.com/event/twiddle/",
   "location":"Cervantes&#8217; Masterpiece Ballroom",
   "offers":{"@type":"Offer","url":"https://www.etix.com/ticket/p/55575657/twiddle-denver"}}
]}
</script></head><body></body></html>`

describe('the event page is read, not guessed', () => {
  const event = extractEvent(EVENT_PAGE, 'https://cervantesmasterpiece.com/event/twiddle/')

  it('finds an Event nested inside @graph', () => {
    expect(event).not.toBeNull()
    expect(event?.name).toBe('Twiddle')
  })

  it('keeps the local date the venue published', () => {
    // 8pm on the 7th in Denver is the 8th in UTC. Every venue this app covers
    // is west of Greenwich, so a Date round-trip would shift every evening show
    // by a day.
    expect(event?.date).toBe('2027-05-07')
    expect(event?.startTime).toBe('20:00:00')
  })

  it('takes the ticket link from the offer', () => {
    expect(event?.ticketUrl).toContain('etix.com')
  })

  it('returns null for a page that describes no event', () => {
    const page = `<html><script type="application/ld+json">
      {"@type":"Organization","name":"Cervantes"}</script></html>`
    expect(extractEvent(page, 'https://example.com/x')).toBeNull()
  })

  it('survives a malformed JSON-LD block alongside a good one', () => {
    const page = `<html>
      <script type="application/ld+json">{ not json </script>
      ${EVENT_PAGE}</html>`
    expect(extractEvent(page, 'https://example.com/x')?.name).toBe('Twiddle')
  })

  it('accepts Event subtypes', () => {
    const page = `<html><script type="application/ld+json">
      {"@type":"MusicEvent","name":"TAUK","startDate":"2027-01-10T21:00:00-0700"}
      </script></html>`
    expect(extractEvent(page, 'https://example.com/x')?.name).toBe('TAUK')
  })

  it('reads the published location, as a string or a Place', () => {
    // Load-bearing: a venue's feed promotes shows at other rooms, and the
    // location is the only thing that distinguishes them.
    expect(event?.locationName).toBe("Cervantes’ Masterpiece Ballroom")

    const asPlace = `<html><script type="application/ld+json">
      {"@type":"Event","name":"Twiddle","startDate":"2027-05-07T20:00:00-0600",
       "location":{"@type":"Place","name":"Red Rocks Amphitheatre"}}</script></html>`
    expect(extractEvent(asPlace, 'https://example.com/x')?.locationName).toBe('Red Rocks Amphitheatre')
  })

  it('handles a date with no time', () => {
    const page = `<html><script type="application/ld+json">
      {"@type":"Event","name":"Festival","startDate":"2027-07-04"}</script></html>`
    const parsed = extractEvent(page, 'https://example.com/x')
    expect(parsed?.date).toBe('2027-07-04')
    expect(parsed?.startTime).toBeNull()
  })
})

describe('a valid feed is not necessarily a current one', () => {
  const now = new Date('2026-11-17T00:00:00Z')

  it('rejects the Salvage Station case', () => {
    // 200, text/calendar, 147KB, fifty perfect VEVENTs, newest from May 2021.
    const verdict = assessFreshness({
      lastBuild: null,
      eventDates: [new Date('2020-10-31'), new Date('2021-03-19'), new Date('2021-05-29')],
      now,
    })
    expect(verdict.fresh).toBe(false)
    expect(verdict.reason).toContain('2021-05-29')
  })

  it('rejects a feed with no dates at all', () => {
    const verdict = assessFreshness({ lastBuild: null, eventDates: [], now })
    expect(verdict.fresh).toBe(false)
    expect(verdict.reason).toContain('no event dates')
  })

  it('accepts a feed with upcoming events and no build date', () => {
    // Content is authoritative: future events make a feed useful whether or not
    // it declares when it was generated.
    const verdict = assessFreshness({
      lastBuild: null,
      eventDates: [new Date('2027-05-07')],
      now,
    })
    expect(verdict.fresh).toBe(true)
    expect(verdict.upcomingCount).toBe(1)
  })

  it('rejects a long-abandoned build date even with future events listed', () => {
    const verdict = assessFreshness({
      lastBuild: new Date('2026-01-01'),
      eventDates: [new Date('2027-05-07')],
      now,
    })
    expect(verdict.fresh).toBe(false)
    expect(verdict.reason).toContain('last built')
  })

  it('accepts a recently built feed', () => {
    const verdict = assessFreshness({
      lastBuild: new Date('2026-11-17T19:43:31Z'),
      eventDates: [new Date('2027-05-07')],
      now,
    })
    expect(verdict.fresh).toBe(true)
  })
})

describe("a venue's own rooms are told apart from the ones it promotes", () => {
  const cervantes = VENUES.find((v) => v.key === 'cervantes-masterpiece')!

  it.each([
    "Cervantes’ Masterpiece Ballroom",
    'Cervantes Masterpiece Ballroom',
    "Cervantes' Other Side",
    'Cervantes & Other Side (Dual Venue)',
  ])('accepts its own room: %s', (name) => {
    expect(cervantes.locationPattern.test(name)).toBe(true)
  })

  it.each([
    'Red Rocks Amphitheatre',
    'Ogden Theatre',
    'Mission Ballroom',
    'Bluebird Theater',
    "Fiddler's Green Amphitheatre",
    'WinterWonderGrass Colorado',
  ])("rejects somebody else's room: %s", (name) => {
    // Eleven of 108 Cervantes listings are at these. WinterWonderGrass is in
    // Steamboat Springs, about 150 miles from the address this venue would
    // otherwise lend it.
    expect(cervantes.locationPattern.test(name)).toBe(false)
  })
})

describe('venues are matched by distance to the search', () => {
  it('includes Cervantes for a Denver search', () => {
    expect(venuesWithin(39.7392, -104.9903, 50).map((v) => v.key)).toContain('cervantes-masterpiece')
  })

  it('excludes it for Burlington', () => {
    expect(venuesWithin(44.4759, -73.2121, 50)).toHaveLength(0)
  })

  it('excludes it for a tight radius around a distant point', () => {
    // Colorado Springs is ~65 miles south.
    expect(venuesWithin(38.8339, -104.8214, 25)).toHaveLength(0)
  })
})
