/**
 * Reads venue calendars into the cache.
 *
 * This is the write half of the second event source. It cannot run on the
 * request path and is not meant to: a venue's feed lists event-page URLs but no
 * usable dates, so each page is fetched for its schema.org Event — 114 pages
 * for Cervantes, paced by the host's crawl-delay. Minutes per venue.
 *
 *   npx tsx scripts/ingest-venues.ts                       # every venue
 *   npx tsx scripts/ingest-venues.ts --venue cervantes-masterpiece
 *   npx tsx scripts/ingest-venues.ts --dry-run             # fetch, write nothing
 *   npx tsx scripts/ingest-venues.ts --list                # registry only
 *
 * Run `--dry-run` before adding a venue to the registry. It reports how many
 * pages yielded an Event and whether the feed is fresh, which is the whole
 * question — of six venues probed, one had a live feed, one served a
 * syntactically perfect iCal whose newest event was from 2021, three published
 * near-empty feeds, and two refused automated requests outright.
 */

import { config } from 'dotenv'
import { VENUES, venueByKey } from '../src/lib/sources/venues/registry'
import { ingestVenue, type IngestResult } from '../src/lib/sources/venues'
import { venueStoreState } from '../src/lib/sources/venues/store'

config({ path: '.env.local' })

const argv = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : null
}
const has = (name: string): boolean => argv.includes(`--${name}`)

function report(result: IngestResult): void {
  const { freshness } = result
  console.log(`\n${result.venue}`)
  console.log(`  feed listed      ${result.listed} event pages`)
  console.log(`  Event JSON-LD    ${result.extracted} extracted`)
  if (result.offsite > 0) {
    console.log(`  off-site         ${result.offsite} skipped (promoted at another venue)`)
  }
  console.log(
    `  freshness        ${freshness.fresh ? 'fresh' : `REJECTED — ${freshness.reason}`}` +
      (freshness.lastBuild ? ` (feed built ${freshness.lastBuild.toISOString().slice(0, 10)})` : '')
  )
  console.log(`  upcoming         ${freshness.upcomingCount}`)
  console.log(`  written          ${result.written}`)

  if (result.errors.length > 0) {
    console.log(`  ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}:`)
    for (const error of result.errors.slice(0, 8)) console.log(`    - ${error}`)
    if (result.errors.length > 8) console.log(`    ... and ${result.errors.length - 8} more`)
  }
}

async function main(): Promise<void> {
  if (has('list')) {
    console.log(`${VENUES.length} registered venue${VENUES.length === 1 ? '' : 's'}:`)
    for (const v of VENUES) {
      console.log(`  ${v.key.padEnd(26)} ${v.name} — ${v.city}, ${v.state}`)
      console.log(`  ${''.padEnd(26)} ${v.feedUrl}`)
    }
    return
  }

  const dryRun = has('dry-run')
  const only = flag('venue')

  const targets = only ? [venueByKey(only)].filter((v) => v !== undefined) : [...VENUES]
  if (targets.length === 0) {
    console.error(`No such venue: "${only}". Run --list to see the registry.`)
    process.exitCode = 1
    return
  }

  const store = venueStoreState()
  if (!dryRun && store.state !== 'ok') {
    console.error(`Cannot write: venue store is ${store.state} (${store.error}).`)
    console.error('Apply supabase/migrations/002_venue_events.sql and set the Supabase env vars,')
    console.error('or pass --dry-run to fetch without writing.')
    process.exitCode = 1
    return
  }

  console.log(
    `ingesting ${targets.length} venue${targets.length === 1 ? '' : 's'}` +
      (dryRun ? ' (dry run — nothing will be written)' : '')
  )

  const results: IngestResult[] = []
  for (const venue of targets) {
    process.stdout.write(`\n${venue.name}: fetching feed... `)
    try {
      const result = await ingestVenue(venue, {
        dryRun,
        onProgress: (done, total) => {
          // One line, rewritten — a progress log of 114 lines per venue buries
          // the problems that actually matter.
          process.stdout.write(`\r${venue.name}: ${done}/${total} pages   `)
        },
      })
      process.stdout.write('\r' + ' '.repeat(60) + '\r')
      results.push(result)
      report(result)
    } catch (err) {
      process.stdout.write('\r' + ' '.repeat(60) + '\r')
      console.error(`\n${venue.key}\n  FAILED: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  }

  const written = results.reduce((sum, r) => sum + r.written, 0)
  const rejected = results.filter((r) => !r.freshness.fresh)
  console.log(
    `\n${'─'.repeat(50)}\n${written} event${written === 1 ? '' : 's'} written across ` +
      `${results.length - rejected.length} venue${results.length - rejected.length === 1 ? '' : 's'}`
  )
  if (rejected.length > 0) {
    console.log(`${rejected.length} venue${rejected.length === 1 ? '' : 's'} rejected for staleness:`)
    for (const r of rejected) console.log(`  ${r.venue} — ${r.freshness.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
