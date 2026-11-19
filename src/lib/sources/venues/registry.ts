/**
 * Venues whose calendars are read directly.
 *
 * Ticketmaster only lists venues that sell tickets through it, and the rooms
 * that matter most to this app frequently do not. Measured for Burlington VT,
 * 50 miles, 180 days, across fourteen classifications: Ticketmaster had eleven
 * events for the entire metro, all at one venue, while that venue's own
 * calendar listed seventy-one. Even in Denver, where Ticketmaster looks strong,
 * it has neither Twiddle nor TAUK at Cervantes — both acts this app already
 * knows by name.
 *
 * So this is a curated list, and curation is the point. It is not a crawler
 * seed: each entry is a room where the local jam scene actually plays, with a
 * feed that has been checked by hand.
 *
 * ── What a venue has to provide ────────────────────────────────────────────
 *
 * An events RSS feed listing event-page URLs, and event pages carrying
 * schema.org `Event` JSON-LD. Verified end to end on Cervantes, whose event
 * page returns exactly what is needed:
 *
 *   @type Event · name "Twiddle" · startDate 2027-05-07T20:00:00-0600
 *   location "Cervantes' Masterpiece Ballroom" · offers.url etix.com/...
 *
 * Feeds were probed across six venues before settling on that shape. The
 * alternatives all failed: The Events Calendar REST API 404s everywhere;
 * listing pages carry no bulk JSON-LD, only loose "Nov 19" text near a link
 * with no year; and iCal is the worst trap of the three, because Salvage
 * Station serves a syntactically valid feed whose newest event is from 2021.
 * That is why `freshness.ts` exists.
 *
 * ── Why coordinates are stored rather than geocoded ───────────────────────
 *
 * A venue does not move. Geocoding it per search would spend a Nominatim
 * request per venue per request to learn something permanent, and the search
 * only needs to filter a handful of venues by distance — cheap in code.
 *
 * Adding a venue is one entry, but only after checking the feed by hand:
 * `npx tsx scripts/ingest-venues.ts --venue <key> --dry-run`.
 */

export type VenueFeedKind = 'wordpress-rss'

export type RegisteredVenue = {
  /** Stable key, used as the storage key and in CLI flags. */
  key: string
  name: string
  city: string
  state: string
  latitude: number
  longitude: number
  /** Feed listing event-page URLs. */
  feedUrl: string
  kind: VenueFeedKind
  /**
   * Matches the `location` a page publishes against this venue's own rooms.
   *
   * Required because a venue's feed advertises shows it books elsewhere.
   * Cervantes lists Red Rocks, the Ogden, Mission Ballroom, Bluebird, Fiddler's
   * Green and WinterWonderGrass alongside its own two rooms; without this they
   * would be ingested at this venue's coordinates. It also has to admit both of
   * its rooms — Masterpiece Ballroom and The Other Side are one address.
   */
  locationPattern: RegExp
  /**
   * Seconds between requests to this host, honouring its robots.txt. Cervantes
   * declares no crawl-delay; 1s is a courtesy floor rather than a requirement.
   */
  crawlDelaySeconds: number
}

export const VENUES: readonly RegisteredVenue[] = [
  {
    key: 'cervantes-masterpiece',
    name: "Cervantes' Masterpiece Ballroom",
    city: 'Denver',
    state: 'CO',
    latitude: 39.7545,
    longitude: -104.9789,
    feedUrl: 'https://cervantesmasterpiece.com/events/feed/',
    kind: 'wordpress-rss',
    // Masterpiece Ballroom, The Other Side and the dual-venue billing are all
    // the same building; anything else in the feed is somebody else's room.
    locationPattern: /cervantes|other\s*side/i,
    crawlDelaySeconds: 1,
  },
]

export const venueByKey = (key: string): RegisteredVenue | undefined =>
  VENUES.find((v) => v.key === key)
