/**
 * Validates the scoring model against real upstream data.
 *
 * The fixture holds verbatim Last.fm and setlist.fm responses for 55 artists —
 * 30 jam acts and 25 country/folk/blues acts that surface in the same
 * Ticketmaster searches. Labels were assigned by hand before any weights were
 * chosen, and the fixture is committed so the model can be retuned offline.
 *
 * The headline assertion is AUC: the probability that a randomly chosen jam act
 * outscores a randomly chosen non-jam act. The model this replaced scored 0.611
 * on Ticketmaster genre and leaked false positives through adjacency stacking.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { scoreTags, scoreSimilar, type LastFmData } from '@/lib/sources/lastfm'
import { EMPTY_SETLIST, type SetlistData } from '@/lib/sources/setlistfm'
import type { ResolvedArtist } from '@/lib/sources/musicbrainz'
import { scoreArtist, type ScoringResult } from '@/lib/scoring'
import { DISPLAY_THRESHOLD } from '@/lib/scoring/weights'

type Fixture = {
  name: string
  label: 'jam' | 'not'
  lastfmTags: Array<{ name: string; count: number }>
  lastfmSimilar: Array<{ name: string; match: string }>
  setlist: {
    showsAnalyzed: number
    jamCoversPerShow: number
    showsWithJamCover: number
    coveredActs: string[]
  } | null
  tmClassification: string
  resolved: ResolvedArtist | null
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(new URL('./fixtures/labeled-artists.json', import.meta.url), 'utf8')
)

function toLastFm(f: Fixture): LastFmData {
  if (f.lastfmTags.length === 0 && f.lastfmSimilar.length === 0) {
    return { tags: [], jamTagStrength: 0, adjacentTagStrength: 0, matchedTags: [], similarityAffinity: 0, similarSeeds: [], found: false }
  }
  return { ...scoreTags(f.lastfmTags), ...scoreSimilar(f.lastfmSimilar), found: true }
}

function toSetlist(f: Fixture): SetlistData {
  if (!f.setlist) return EMPTY_SETLIST
  return {
    ...EMPTY_SETLIST,
    showsAnalyzed: f.setlist.showsAnalyzed,
    jamCoversPerShow: f.setlist.jamCoversPerShow,
    showsWithJamCover: f.setlist.showsWithJamCover,
    coveredActs: f.setlist.coveredActs,
    found: true,
  }
}

const scored: Array<Fixture & { result: ScoringResult }> = fixtures.map((f) => ({
  ...f,
  result: scoreArtist({ artistName: f.name, resolved: f.resolved, lastfm: toLastFm(f), setlist: toSetlist(f) }),
}))

const jam = scored.filter((s) => s.label === 'jam')
const not = scored.filter((s) => s.label === 'not')

/** Mann-Whitney U — P(random jam act outscores random non-jam act). */
function auc(values: (s: (typeof scored)[number]) => number): number {
  let wins = 0
  for (const a of jam) for (const b of not) {
    const [x, y] = [values(a), values(b)]
    wins += x > y ? 1 : x === y ? 0.5 : 0
  }
  return wins / (jam.length * not.length)
}

describe('scoring model — separation', () => {
  it('separates jam from non-jam acts far better than chance', () => {
    const score = auc((s) => s.result.score)
     
    console.log(`\n  AUC = ${score.toFixed(3)}  (0.5 = coin flip)`)
    expect(score).toBeGreaterThan(0.9)
  })

  it('scores jam acts substantially higher on average', () => {
    const mean = (set: typeof scored) => set.reduce((a, s) => a + s.result.score, 0) / set.length
    const jamMean = mean(jam)
    const notMean = mean(not)
     
    console.log(`  mean score: jam=${jamMean.toFixed(2)}  non-jam=${notMean.toFixed(2)}`)
    expect(jamMean).toBeGreaterThan(notMean * 2)
  })

  it('surfaces most jam acts and few non-jam acts', () => {
    const jamSurfaced = jam.filter((s) => s.result.surfaces).length
    const notSurfaced = not.filter((s) => s.result.surfaces).length
     
    console.log(`  surfaced: ${jamSurfaced}/${jam.length} jam, ${notSurfaced}/${not.length} non-jam\n`)
    expect(jamSurfaced / jam.length).toBeGreaterThan(0.7)
    expect(notSurfaced / not.length).toBeLessThan(0.25)
  })
})

describe('scoring model — regressions the old model had', () => {
  const byName = (name: string) => {
    const found = scored.find((s) => s.name === name)
    if (!found) throw new Error(`fixture missing: ${name}`)
    return found
  }

  it('keeps acknowledged country and folk stars below the display threshold', () => {
    for (const name of ['Chris Stapleton', "I'm With Her", 'Luke Combs', 'Noah Kahan']) {
      expect(byName(name).result.score, name).toBeLessThan(DISPLAY_THRESHOLD)
    }
  })

  it('no longer lets a blues-rock act outscore real jam bands on adjacency alone', () => {
    // Marcus King previously reached 7.0 — the top of the Tier 1 floor — on a
    // keyword match plus Allman Brothers covers.
    const marcusKing = byName('Marcus King').result.score
    for (const name of ['Phish', 'Widespread Panic', "Umphrey's McGee", 'The String Cheese Incident']) {
      expect(byName(name).result.score, `${name} vs Marcus King`).toBeGreaterThan(marcusKing)
    }
  })

  it('ranks Phish above a band with a single lucky signal', () => {
    expect(byName('Phish').result.score).toBeGreaterThan(8)
  })

  it('does not punish jam bands that play their own material', () => {
    // These cover almost nothing (0.00–0.07 jam covers per show) yet are
    // undisputed jam acts. Under the old model, raw song counts buried them.
    for (const name of ['Widespread Panic', 'The Disco Biscuits', 'Spafford']) {
      expect(byName(name).result.score, name).toBeGreaterThan(DISPLAY_THRESHOLD)
    }
  })

  it('exposes which signals produced the score', () => {
    const phish = byName('Phish').result
    expect(phish.contributions.length).toBeGreaterThan(2)
    // Contributions must account for the score, so the number is never opaque.
    const sum = phish.contributions.reduce((a, c) => a + c.points, 0)
    expect(Math.min(sum, 10)).toBeCloseTo(phish.score, 1)
    // No contribution may exceed its declared ceiling.
    for (const c of phish.contributions) expect(c.points).toBeLessThanOrEqual(c.max)
  })

  it('withholds the tag signal for ambiguous names instead of penalising them', () => {
    // Last.fm returns the Belgian electro act's tags for the Connecticut jam
    // band Goose. That must not read as evidence against Goose.
    const goose = byName('Goose').result
    expect(goose.nameAmbiguous).toBe(true)
    expect(goose.score).toBeGreaterThan(DISPLAY_THRESHOLD)
  })
})

describe('scoring model — shape', () => {
  it('is continuous, with no tier cliff', () => {
    // The old model produced a 7.0 plateau: 11 of 55 acts landed on exactly 7.0
    // because list membership set a floor. No single value should dominate.
    const counts = new Map<number, number>()
    for (const s of scored) counts.set(s.result.score, (counts.get(s.result.score) ?? 0) + 1)
    const biggestCluster = Math.max(...[...counts.values()])
    expect(biggestCluster).toBeLessThan(scored.length * 0.3)
  })

  it('stays within 0–10', () => {
    for (const s of scored) {
      expect(s.result.score).toBeGreaterThanOrEqual(0)
      expect(s.result.score).toBeLessThanOrEqual(10)
    }
  })

  it('gives identical input identical output', () => {
    const f = fixtures[0]!
    const input = { artistName: f.name, resolved: f.resolved, lastfm: toLastFm(f), setlist: toSetlist(f) }
    expect(scoreArtist(input).score).toBe(scoreArtist(input).score)
  })
})
