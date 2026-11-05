/**
 * Prints the full ranked list so model changes are inspectable, and asserts the
 * ordering properties that matter.
 *
 * Run with `npm run test:scores` to see the table.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { scoreTags, scoreSimilar, type LastFmData } from '@/lib/sources/lastfm'
import { EMPTY_SETLIST, type SetlistData } from '@/lib/sources/setlistfm'
import type { ResolvedArtist } from '@/lib/sources/musicbrainz'
import { scoreArtist } from '@/lib/scoring'

type Fixture = {
  name: string
  label: 'jam' | 'not'
  lastfmTags: Array<{ name: string; count: number }>
  lastfmSimilar: Array<{ name: string; match: string }>
  setlist: { showsAnalyzed: number; jamCoversPerShow: number; showsWithJamCover: number; coveredActs: string[] } | null
  resolved: ResolvedArtist | null
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(new URL('./fixtures/labeled-artists.json', import.meta.url), 'utf8')
)

const toLastFm = (f: Fixture): LastFmData =>
  f.lastfmTags.length === 0 && f.lastfmSimilar.length === 0
    ? { tags: [], jamTagStrength: 0, adjacentTagStrength: 0, matchedTags: [], similarityAffinity: 0, similarSeeds: [], found: false }
    : { ...scoreTags(f.lastfmTags), ...scoreSimilar(f.lastfmSimilar), found: true }

const toSetlist = (f: Fixture): SetlistData =>
  f.setlist
    ? { ...EMPTY_SETLIST, ...f.setlist, found: true }
    : EMPTY_SETLIST

const ranked = fixtures
  .map((f) => ({ f, r: scoreArtist({ artistName: f.name, resolved: f.resolved, lastfm: toLastFm(f), setlist: toSetlist(f) }) }))
  .sort((a, b) => b.r.score - a.r.score)

describe('ranked labelled set', () => {
  it('prints the table', () => {
    const lines = ranked.map(({ f, r }) => {
      const flag = f.label === 'jam' ? (r.surfaces ? '  ' : '!!') : r.surfaces ? '!!' : '  '
      return `  ${flag} ${String(r.score).padStart(4)}  sig=${String(r.signalCount).padStart(2)}  ${f.label === 'jam' ? 'JAM' : '   '}  ${f.name.padEnd(28)} ${r.reasons[0] ?? ''}`
    })
     
    console.log('\n  !! marks a disagreement with the hand label\n' + lines.join('\n') + '\n')
    expect(ranked.length).toBe(fixtures.length)
  })

  it('places every non-jam act below every surfaced threshold breach', () => {
    const topNonJam = Math.max(...ranked.filter((x) => x.f.label === 'not').map((x) => x.r.score))
    const jamAbove = ranked.filter((x) => x.f.label === 'jam' && x.r.score > topNonJam).length
     
    console.log(`  highest non-jam score: ${topNonJam} — ${jamAbove}/30 jam acts rank above it`)
    expect(jamAbove).toBeGreaterThan(20)
  })
})
