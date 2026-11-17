/**
 * Validates the strictness apertures against the labelled set.
 *
 * The point of the feature is that the contested acts — the thirty labelled
 * `borderline` and held out of fitting — are a question about taste rather than
 * accuracy, and 23 of them clear the shipped threshold. A strict setting has to
 * actually remove them, or the control is decoration.
 *
 * The assertions are deliberately about ordering and composition rather than
 * exact counts, because the counts move whenever the model is refit and a test
 * that pins them would fail for the wrong reason. What must not change is that
 * strict is a subset of balanced, and that strict admits no act the labelled set
 * calls non-jam.
 */

import { describe, expect, it } from 'vitest'
import { loadLabelledArtists, type LabelledArtist } from './fixtures/load'
import { runModel } from '@/lib/scoring/model'
import {
  APERTURES,
  DEFAULT_APERTURE,
  marginalFloor,
  parseAperture,
  MARGINAL_BAND,
} from '@/lib/scoring/aperture'

const artists = loadLabelledArtists()

function score(a: LabelledArtist): number {
  return runModel({
    tags: a.tags.map((t) => t.name),
    similar: a.similar,
    coreCoversPerShow: a.setlist.resolved ? a.setlist.coreCoversPerShow : null,
    showsWithCover: a.setlist.resolved ? a.setlist.showsWithCore : null,
    jamDisambiguation: a.mb?.jamDisambiguation ?? false,
    setlistResolved: a.setlist.resolved,
  }).score
}

const scored = artists.map((a) => ({ a, score: score(a) }))
const admits = (minScore: number) => scored.filter((s) => s.score >= minScore)
const countOf = (minScore: number, label: LabelledArtist['label']) =>
  admits(minScore).filter((s) => s.a.label === label).length

describe('the apertures are ordered', () => {
  it('runs strict, then balanced, then wide', () => {
    expect(APERTURES.strict.minScore).toBeGreaterThan(APERTURES.balanced.minScore)
    expect(APERTURES.balanced.minScore).toBeGreaterThan(APERTURES.wide.minScore)
  })

  it('defaults to the learned threshold, not a hand-picked one', () => {
    // The 3.6 cut is fitted as the highest recall holding precision at 90%.
    // Shipping a different default would discard that for everyone.
    expect(DEFAULT_APERTURE).toBe('balanced')
  })

  it('admits a strict subset as it tightens', () => {
    const strict = new Set(admits(APERTURES.strict.minScore).map((s) => s.a.name))
    const balanced = new Set(admits(APERTURES.balanced.minScore).map((s) => s.a.name))
    const wide = admits(APERTURES.wide.minScore).map((s) => s.a.name)

    for (const name of strict) expect(balanced.has(name)).toBe(true)
    for (const name of balanced) expect(wide).toContain(name)
    expect(strict.size).toBeLessThan(balanced.size)
  })
})

describe('strict actually removes the contested acts', () => {
  it('admits nothing the labelled set calls non-jam', () => {
    expect(countOf(APERTURES.strict.minScore, 'pool')).toBe(0)
  })

  it('admits far fewer contested acts than the default', () => {
    const strict = countOf(APERTURES.strict.minScore, 'borderline')
    const balanced = countOf(APERTURES.balanced.minScore, 'borderline')
    // 23 of 30 clear the default cut; strict has to be a different answer, not
    // a slightly smaller one.
    expect(balanced).toBeGreaterThan(20)
    expect(strict).toBeLessThanOrEqual(2)
  })

  it('keeps a majority of the real jam acts', () => {
    // Precision is bought with recall here, deliberately, but a setting that
    // dropped most real acts would not be worth offering.
    const jamTotal = scored.filter((s) => s.a.label === 'jam').length
    expect(countOf(APERTURES.strict.minScore, 'jam') / jamTotal).toBeGreaterThan(0.5)
  })
})

describe('the weaker-evidence band follows the chosen cut', () => {
  it('sits one band below whatever the cut is', () => {
    expect(marginalFloor(7)).toBeCloseTo(7 - MARGINAL_BAND, 5)
    expect(marginalFloor(APERTURES.balanced.minScore)).toBeCloseTo(
      APERTURES.balanced.minScore - MARGINAL_BAND,
      5
    )
  })

  it('never goes below zero', () => {
    expect(marginalFloor(0.5)).toBeGreaterThan(0)
    expect(marginalFloor(0)).toBeGreaterThan(0)
  })
})

describe('the URL parameter is forgiving', () => {
  it.each(['strict', 'balanced', 'wide'])('accepts %s', (value) => {
    expect(parseAperture(value)).toBe(value)
  })

  it.each([undefined, null, '', 'STRICT', 'nonsense', '7'])(
    'falls back on %s rather than throwing',
    (value) => {
      expect(parseAperture(value)).toBe(DEFAULT_APERTURE)
    }
  )
})
