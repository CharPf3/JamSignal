/**
 * Rejects feeds that are published but abandoned.
 *
 * This exists because of Salvage Station. Its iCal endpoint returns HTTP 200,
 * `text/calendar`, 147KB, fifty syntactically perfect VEVENTs — and the newest
 * one is from May 2021. The venue moved its live calendar elsewhere and left
 * the old feed serving, so every signal a naive fetcher looks at says the data
 * is good.
 *
 * Without this check the app would have confidently shown shows that happened
 * five years ago, which is worse than showing nothing: the whole point of the
 * coverage work is that the app should not state things it cannot support.
 *
 * Two independent tests, because either can pass alone on a dead feed:
 *
 *   recency   the feed claims to have been rebuilt recently. Cheap, but a
 *             static file can carry any date, and some feeds omit it.
 *   content   at least one event is actually in the future. This is the one
 *             that catches Salvage Station, whose dates are all historical.
 */

/** A feed whose newest event is older than this is treated as abandoned. */
const MAX_LAST_BUILD_AGE_DAYS = 14

export type FreshnessVerdict = {
  fresh: boolean
  /** Why it was rejected, for the ingestion log. Null when fresh. */
  reason: string | null
  lastBuild: Date | null
  upcomingCount: number
}

/**
 * Judges a feed from its declared build date and the dates it carries.
 *
 * `upcomingCount` is authoritative: a feed with future events is useful even
 * if it never declares a build date, and a feed with none is useless however
 * recently it claims to have been generated.
 */
export function assessFreshness(args: {
  lastBuild: Date | null
  /** Event start dates parsed from the feed or its event pages. */
  eventDates: Date[]
  now?: Date
}): FreshnessVerdict {
  const now = args.now ?? new Date()
  const upcoming = args.eventDates.filter((d) => d.getTime() >= now.getTime())

  if (upcoming.length === 0) {
    const newest = args.eventDates.reduce<Date | null>(
      (max, d) => (max === null || d > max ? d : max),
      null
    )
    return {
      fresh: false,
      reason: newest
        ? `no upcoming events; newest is ${newest.toISOString().slice(0, 10)}`
        : 'no event dates found',
      lastBuild: args.lastBuild,
      upcomingCount: 0,
    }
  }

  if (args.lastBuild) {
    const ageDays = (now.getTime() - args.lastBuild.getTime()) / 86_400_000
    if (ageDays > MAX_LAST_BUILD_AGE_DAYS) {
      return {
        fresh: false,
        reason: `feed last built ${Math.round(ageDays)} days ago`,
        lastBuild: args.lastBuild,
        upcomingCount: upcoming.length,
      }
    }
  }

  return { fresh: true, reason: null, lastBuild: args.lastBuild, upcomingCount: upcoming.length }
}
