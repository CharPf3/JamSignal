/**
 * How much of a market the event source can actually see.
 *
 * Ticketmaster's coverage is not uniformly thin or uniformly good — it is
 * bimodal. Where a venue sells its tickets through Ticketmaster, the API
 * returns that venue's whole calendar. Where it does not, the API returns only
 * the occasional one-off that happened to be sold through it, and says nothing
 * about the rest.
 *
 * Measured across fourteen markets, 50 miles, 90 days:
 *
 *   market              events  venues   busiest venue
 *   Ithaca, NY              99      13   Funk 'n Waffles        37
 *   Asheville, NC           64      10   The Orange Peel        26
 *   Madison, WI             55       8   High Noon Saloon       21
 *   Charlottesville, VA     40       4   Jefferson Theater      18
 *   Missoula, MT            10       2   The Wilma               6
 *   Burlington, VT           3       2   Higher Ground           2
 *
 * Burlington is the case that matters. Higher Ground's own calendar lists 71
 * upcoming shows; Ticketmaster had two of them, knew no other venue in Vermont,
 * and reported every query as successful. The shows it missed were the ones
 * this app exists to find — Tom Hamilton, lespecial, Karina Rykman, a Grateful
 * Dead night billed as Dead Sessions.
 *
 * So "all queries succeeded" is not coverage, and presenting it as such told
 * users that nothing was happening in Phish's hometown.
 *
 * ── The signal ──────────────────────────────────────────────────────────────
 *
 * Events at the busiest single venue, normalised per 30 days. A venue whose
 * ticketing runs through Ticketmaster shows 6–12 events per 30 days; a venue
 * that merely appears in it shows 0.7–2. The two populations do not overlap on
 * any market measured, and the gap is wide enough that the threshold does not
 * need to be precise.
 *
 * Normalising by the window matters: the search accepts 7 to 180 days, and a
 * one-week search would put every venue in the country under an absolute cut.
 */

import type { Event } from '@/types'

/**
 * Events per 30 days at a single venue above which its calendar appears to be
 * carried rather than sampled. Measured separation is 2 against 6, so this sits
 * in the gap rather than on either population.
 */
const ANCHOR_EVENTS_PER_30_DAYS = 4

/** The shortest window the pipeline will accept — see DAYS_LIMITS there. */
const MIN_WINDOW_DAYS = 7

export type MarketCoverage = {
  /** Distinct venues with at least one event in the window. */
  venues: number
  /** Venues whose own calendar the source appears to carry. */
  anchor_venues: number
  /** Events per 30 days at the busiest venue — the discriminating signal. */
  peak_venue_rate: number
  /**
   * True when no venue in range looks like a carried calendar, so the absence
   * of results says more about the source than about the market.
   */
  sparse: boolean
}

export function assessCoverage(events: Event[], days: number): MarketCoverage {
  const perVenue = new Map<string, number>()
  for (const event of events) {
    const venue = event.venue_name.toLowerCase().trim()
    if (!venue) continue
    perVenue.set(venue, (perVenue.get(venue) ?? 0) + 1)
  }

  // `days` is validated to 7–180 by the pipeline before this runs. The floor
  // treats anything shorter as the shortest real search rather than dividing by
  // something near zero — clamping to 1 day instead would scale a single event
  // up to thirty and make every venue an anchor.
  const windows = Math.max(days, MIN_WINDOW_DAYS) / 30
  const rate = (count: number) => count / windows

  let anchors = 0
  let peak = 0
  for (const count of perVenue.values()) {
    const venueRate = rate(count)
    if (venueRate >= ANCHOR_EVENTS_PER_30_DAYS) anchors++
    if (venueRate > peak) peak = venueRate
  }

  return {
    venues: perVenue.size,
    anchor_venues: anchors,
    peak_venue_rate: Number(peak.toFixed(1)),
    sparse: anchors === 0,
  }
}

/**
 * A plain statement of what the source could see, or null when coverage looks
 * normal and there is nothing worth saying.
 *
 * Deliberately explains the mechanism. "No shows found" invites the conclusion
 * that nothing is happening; naming ticketing as the reason invites the correct
 * one, which is to go look at the venue's own calendar.
 */
export function coverageNote(coverage: MarketCoverage, radius: number): string | null {
  if (!coverage.sparse) return null

  const where = `within ${radius} miles`

  if (coverage.venues === 0) {
    return `Ticketmaster lists no venues ${where} for these dates. That usually means the rooms nearby sell tickets elsewhere, not that nothing is booked.`
  }

  const venues = coverage.venues === 1 ? '1 venue' : `${coverage.venues} venues`
  return `Ticketmaster lists only ${venues} ${where}, and does not appear to carry a full calendar for any of them. Independent rooms often sell tickets through their own site, so their shows are invisible here.`
}
