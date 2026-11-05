/**
 * Warms the artist index offline.
 *
 * This is what makes the precomputed-index architecture pay off. On the request
 * path, analysis is capped by a budget so a search cannot take minutes, which
 * means a cold index leaves most artists marked pending. Here there is no
 * budget and no user waiting, so rate limits only cost wall-clock time:
 * MusicBrainz allows one request per second, so roughly 60 artists per minute.
 *
 *   npx tsx scripts/backfill.ts --acts                    # the curated list
 *   npx tsx scripts/backfill.ts --location "Madison, WI"   # everyone playing there
 *   npx tsx scripts/backfill.ts --location "Denver, CO" --radius 100 --days 120
 *   npx tsx scripts/backfill.ts --artist "Armchair Boogie" # one artist, verbose
 *   npx tsx scripts/backfill.ts --acts --dry-run           # no writes
 *
 * Run it against the cities you care about and searches there become fast and
 * identical run to run. Run `--acts` once after creating a fresh Supabase
 * project to seed the index with every act we already know of.
 */

import { config } from 'dotenv'
import { normalizeName } from '../src/lib/canon/normalize'
import { KNOWN_ACTS } from '../src/lib/canon/acts'
import { analyzeArtist } from '../src/lib/artists'
import { readArtists, writeArtists, cacheStatus } from '../src/lib/artists/cache'
import { geocodeLocation } from '../src/lib/sources/geocoding'
import { fetchEvents } from '../src/lib/sources/ticketmaster'
import { missingKeys } from '../src/lib/core/env'

config({ path: '.env.local' })

type Options = {
  acts: boolean
  location: string | null
  artist: string | null
  radius: number
  days: number
  force: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : null
  }
  return {
    acts: argv.includes('--acts'),
    location: get('--location'),
    artist: get('--artist'),
    radius: Number(get('--radius')) || 50,
    days: Number(get('--days')) || 60,
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
  }
}

/** Every artist playing in range of a location, via the normal event search. */
async function artistsNear(location: string, radius: number, days: number): Promise<string[]> {
  const geo = await geocodeLocation(location)
  if (!geo) throw new Error(`Could not geocode "${location}"`)

  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const { events, queriesFailed, queriesIssued } = await fetchEvents({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radius,
    startDate: fmt(now),
    endDate: fmt(end),
  })

  console.log(`  ${geo.label} — ${events.length} events from ${queriesIssued - queriesFailed}/${queriesIssued} queries`)
  if (queriesFailed > 0) console.warn(`  warning: ${queriesFailed} queries failed; coverage is incomplete`)

  return [...new Set(events.map((e) => e.artist_name))]
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const missing = missingKeys()
  if (missing.length > 0) {
    console.warn(`warning: missing config — ${missing.join(', ')}`)
  }

  // Single-artist mode: print the analysis rather than just counting it.
  if (options.artist) {
    const analysis = await analyzeArtist(options.artist)
    console.log(JSON.stringify(analysis, null, 2))
    if (!options.dryRun) {
      await writeArtists([
        { key: normalizeName(options.artist), name: options.artist, mbid: analysis.mbid, analysis },
      ])
      console.log(`\nwritten to the index (cache ${cacheStatus().state})`)
    }
    return
  }

  const names = new Set<string>()
  if (options.acts) {
    for (const act of KNOWN_ACTS) names.add(act)
    console.log(`queued ${KNOWN_ACTS.length} curated acts`)
  }
  if (options.location) {
    const near = await artistsNear(options.location, options.radius, options.days)
    for (const name of near) names.add(name)
    console.log(`queued ${near.length} artists playing near ${options.location}`)
  }

  if (names.size === 0) {
    console.error('Nothing to do. Pass --acts, --location "City, ST", or --artist "Name".')
    process.exitCode = 1
    return
  }

  // Collapse spellings, then skip anything already fresh in the index.
  const byKey = new Map<string, string>()
  for (const name of names) {
    const key = normalizeName(name)
    if (key && !byKey.has(key)) byKey.set(key, name)
  }

  let queue = [...byKey.entries()]
  if (!options.force) {
    const existing = await readArtists(queue.map(([key]) => key))
    const before = queue.length
    queue = queue.filter(([key]) => !existing.has(key))
    if (before !== queue.length) console.log(`skipping ${before - queue.length} already in the index`)
  }

  if (queue.length === 0) {
    console.log('index is already warm for this set.')
    return
  }

  const estimateMinutes = Math.ceil(queue.length / 55)
  console.log(
    `\nanalysing ${queue.length} artists — roughly ${estimateMinutes} ${estimateMinutes === 1 ? 'minute' : 'minutes'} ` +
    `(MusicBrainz allows 1 request/second)\n`
  )

  const started = Date.now()
  const batch: Array<{ key: string; name: string; mbid: string | null; analysis: Awaited<ReturnType<typeof analyzeArtist>> }> = []
  const surfaced: Array<{ name: string; score: number }> = []
  let failures = 0

  for (const [index, [key, name]] of queue.entries()) {
    try {
      const analysis = await analyzeArtist(name)
      batch.push({ key, name, mbid: analysis.mbid, analysis })
      if (analysis.score >= 2.5) surfaced.push({ name: analysis.name, score: analysis.score })

      const marker = analysis.score >= 6 ? '**' : analysis.score >= 2.5 ? ' *' : '  '
      console.log(
        `${String(index + 1).padStart(4)}/${queue.length} ${marker} ${String(analysis.score).padStart(4)}  ${analysis.name}` +
        (analysis.name_ambiguous ? '  (ambiguous name)' : '')
      )
    } catch (err) {
      failures++
      console.warn(`${String(index + 1).padStart(4)}/${queue.length}  !!  ${name} — ${err instanceof Error ? err.message : err}`)
    }

    // Flush periodically so a long run is not lost to an interruption.
    if (batch.length >= 25 && !options.dryRun) {
      await writeArtists(batch.splice(0, batch.length))
    }
  }

  if (batch.length > 0 && !options.dryRun) await writeArtists(batch)

  const elapsed = Math.round((Date.now() - started) / 1000)
  console.log(
    `\ndone in ${Math.floor(elapsed / 60)}m${elapsed % 60}s — ` +
    `${queue.length - failures} analysed, ${failures} failed, ${surfaced.length} scored at or above 2.5`
  )
  console.log(`cache: ${JSON.stringify(cacheStatus())}`)
  if (options.dryRun) console.log('(dry run — nothing written)')

  if (surfaced.length > 0) {
    console.log('\ntop results:')
    for (const entry of surfaced.sort((a, b) => b.score - a.score).slice(0, 20)) {
      console.log(`  ${String(entry.score).padStart(4)}  ${entry.name}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
