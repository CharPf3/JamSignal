/**
 * Validates the shipped model against the labelled set.
 *
 * These assertions guard the properties that were actually broken before, each
 * traceable to a specific failure:
 *
 *   - recall at the operating threshold, because the previous model dropped
 *     real jam bands and AUC never showed it
 *   - the Grateful Dead, Gov't Mule, Billy Strings and Tedeschi Trucks, which
 *     the rank-weighted tag term buried between 2.8 and 3.8 out of 10
 *   - acts whose Last.fm lookup returns the wrong band entirely, which cover
 *     attribution is supposed to rescue
 *   - precision, so recall is never bought by surfacing everything
 */

import { describe, expect, it } from 'vitest'
import { loadLabelledArtists, type LabelledArtist } from './fixtures/load'
import { runModel, DISPLAY_THRESHOLD, MODEL_METRICS } from '@/lib/scoring/model'

const artists = loadLabelledArtists()
const scored = artists.map((a) => ({ a, out: score(a) }))

function score(a: LabelledArtist) {
  return runModel({
    tags: a.tags.map((t) => t.name),
    similar: a.similar,
    coreCoversPerShow: a.setlist.resolved ? a.setlist.coreCoversPerShow : null,
    showsWithCover: a.setlist.resolved ? a.setlist.showsWithCore : null,
    jamDisambiguation: a.mb?.jamDisambiguation ?? false,
    setlistResolved: a.setlist.resolved,
  })
}

const byName = (name: string) => {
  const hit = scored.find((s) => s.a.name === name)
  if (!hit) throw new Error(`fixture missing: ${name}`)
  return hit.out
}

const jam = scored.filter((s) => s.a.label === 'jam')
const nonJam = scored.filter((s) => s.a.label === 'pool')

describe('model — operating point', () => {
  it('surfaces the great majority of known jam acts', () => {
    const hit = jam.filter((s) => s.out.surfaces).length
    const recall = hit / jam.length
     
    console.log(`\n  recall on the full labelled set: ${(recall * 100).toFixed(1)}% (${hit}/${jam.length})`)
    expect(recall).toBeGreaterThan(0.9)
  })

  it('keeps precision high', () => {
    const fp = nonJam.filter((s) => s.out.surfaces).length
    const tp = jam.filter((s) => s.out.surfaces).length
    const precision = tp / (tp + fp)
     
    console.log(`  precision: ${(precision * 100).toFixed(1)}% (${fp} false positives of ${nonJam.length} non-jam)\n`)
    expect(precision).toBeGreaterThan(0.85)
  })

  it('reports held-out metrics from the fitting run', () => {
    // These come from 25 stratified splits in scripts/fit-model.ts, so they are
    // generalisation estimates rather than the in-sample numbers above.
    expect(MODEL_METRICS.recall.mean).toBeGreaterThan(0.9)
    expect(MODEL_METRICS.precision.mean).toBeGreaterThan(0.85)
  })
})

describe('model — acts the previous version buried', () => {
  // Each of these carries a jam tag at a low count against a huge generic tag,
  // which the old share-of-top-tag weighting crushed to near zero.
  const PREVIOUSLY_BURIED = [
    'Grateful Dead',      // "Jam"(10) against "Psychedelic Rock"(100) -> scored 3.7
    "Gov't Mule",         // "Jam"(10) against "blues rock"(100)       -> scored 3.8
    'Billy Strings',      // "jamgrass"(6) against "bluegrass"(100)    -> scored 3.4
    'Tedeschi Trucks Band', // "jam band"(4) against "blues rock"(100) -> scored 2.8
  ]

  it.each(PREVIOUSLY_BURIED)('surfaces %s', (name) => {
    expect(byName(name).surfaces).toBe(true)
  })

  it('ranks the Grateful Dead as a strong signal, not a marginal one', () => {
    expect(byName('Grateful Dead').score).toBeGreaterThan(6)
  })
})

describe('model — cover attribution rescues wrong-artist lookups', () => {
  // Last.fm resolves these names to unrelated bands. Setlist.fm, keyed by
  // MusicBrainz id, does not depend on that index at all.
  const WRONG_ON_LASTFM = [
    'Cubensis',       // Last.fm: thrash metal.  8.45 Dead covers/show
    'The Other Ones', // Last.fm: Australian new wave. 12.47 Dead covers/show
    'Terrapin Flyer', // 10.47 Dead covers/show
  ]

  it.each(WRONG_ON_LASTFM)('surfaces %s on live evidence alone', (name) => {
    const out = byName(name)
    expect(out.overridden, `${name} should trigger the cover override`).toBe(true)
    expect(out.surfaces).toBe(true)
  })

  it('does not let the override fire on acts that merely play a cover or two', () => {
    const overridden = nonJam.filter((s) => s.out.overridden)
    expect(overridden.map((s) => s.a.name)).toEqual([])
  })
})

describe('model — non-jam acts stay down', () => {
  const SHOULD_NOT_SURFACE = ['Chris Stapleton', 'Luke Combs', 'Zach Bryan', 'Noah Kahan']

  it.each(SHOULD_NOT_SURFACE)('keeps %s below the threshold', (name) => {
    const hit = scored.find((s) => s.a.name === name)
    if (!hit) return // not every city sample contains every act
    expect(hit.out.surfaces).toBe(false)
  })
})

describe('model — output shape', () => {
  it('scores are the probability times ten, within 0–10', () => {
    for (const { out } of scored) {
      expect(out.score).toBeCloseTo(out.probability * 10, 1)
      expect(out.score).toBeGreaterThanOrEqual(0)
      expect(out.score).toBeLessThanOrEqual(10)
    }
  })

  it('is deterministic', () => {
    const a = artists[0]!
    expect(score(a).probability).toBe(score(a).probability)
  })

  it('explains every surfaced artist', () => {
    for (const { a, out } of scored) {
      if (!out.surfaces) continue
      expect(out.contributions.length, `${a.name} surfaced with no contributions`).toBeGreaterThan(0)
    }
  })

  it('exposes a threshold consistent with the artifact', () => {
    expect(DISPLAY_THRESHOLD).toBeGreaterThan(0)
    expect(DISPLAY_THRESHOLD).toBeLessThan(10)
  })
})
