/**
 * Validates the market-coverage assessment against the measured markets.
 *
 * The venue distributions below are real — Ticketmaster, 50 miles, 90 days,
 * 2026-11-17 — and they are the reason the rule exists. Burlington is the case
 * that motivated it: two venues, three events, every query successful, while
 * one venue inside the radius had 71 shows on sale elsewhere.
 *
 * The assertions guard the two things that can actually break:
 *
 *   - the separation between a carried calendar and a sampled one, which is the
 *     whole signal and is only as good as the gap between 2 and 6 events
 *   - normalisation by window length, because the search accepts 7 to 180 days
 *     and an absolute cut would call every market in the country blind
 */

import { describe, expect, it } from 'vitest'
import { assessCoverage, coverageNote } from '@/lib/coverage'
import type { Event } from '@/types'

/** Builds a window's worth of events from a venue -> count map. */
function market(venues: Record<string, number>): Event[] {
  const events: Event[] = []
  for (const [venue, count] of Object.entries(venues)) {
    for (let i = 0; i < count; i++) {
      events.push({
        id: `${venue}-${i}`,
        source: 'ticketmaster',
        event_title: `Show ${i}`,
        artist_name: `Artist ${i}`,
        venue_name: venue,
        venue_city: '',
        venue_state: null,
        venue_latitude: null,
        venue_longitude: null,
        date: '2026-12-01',
        start_time: null,
        ticket_url: null,
        distance_miles: null,
        tm_genre: null,
        tm_subgenre: null,
      })
    }
  }
  return events
}

// Measured 2026-11-17, Ticketmaster, 50mi, 90 days.
const MEASURED = {
  ithaca: { "Funk 'n Waffles": 37, 'Middle Ages Music Hall': 31, 'del Lago Resort': 8, 'Rec Room': 6 },
  asheville: { 'The Orange Peel': 26, "Harrah's Cherokee": 12, 'Radio Room': 9, 'Third Room': 2 },
  madison: { 'High Noon Saloon': 21, 'Majestic Theatre': 11, 'The Sylvee': 9, 'Barrymore Theatre': 3 },
  charlottesville: { 'Jefferson Theater': 18, 'The Southern': 15, 'Paramount Theater': 4 },
  missoula: { 'The Wilma': 6, 'Top Hat': 4 },
  burlington: { 'Higher Ground': 2, 'Showcase Lounge at Higher Ground': 1 },
}

describe('coverage separates a carried calendar from a sampled one', () => {
  it.each([
    ['Ithaca', MEASURED.ithaca],
    ['Asheville', MEASURED.asheville],
    ['Madison', MEASURED.madison],
    ['Charlottesville', MEASURED.charlottesville],
  ])('%s is not sparse', (_name, venues) => {
    expect(assessCoverage(market(venues), 90).sparse).toBe(false)
  })

  it.each([
    ['Burlington', MEASURED.burlington],
    ['Missoula', MEASURED.missoula],
  ])('%s is sparse', (_name, venues) => {
    expect(assessCoverage(market(venues), 90).sparse).toBe(true)
  })

  it('reports the busiest venue rate, not the market total', () => {
    const madison = assessCoverage(market(MEASURED.madison), 90)
    // 21 events over 90 days is 7 per 30.
    expect(madison.peak_venue_rate).toBeCloseTo(7, 1)
    expect(madison.venues).toBe(4)
    expect(madison.anchor_venues).toBe(1)
  })

  it('counts every venue whose calendar is carried', () => {
    // Funk 'n Waffles and Middle Ages both clear the cut; del Lago does not.
    expect(assessCoverage(market(MEASURED.ithaca), 90).anchor_venues).toBe(2)
  })
})

describe('coverage is normalised by the search window', () => {
  it('does not call a one-week search blind', () => {
    // Four shows in seven days is a busy room, and an absolute cut would miss
    // that. The app accepts windows from 7 to 180 days.
    expect(assessCoverage(market({ 'High Noon Saloon': 4 }), 7).sparse).toBe(false)
  })

  it('does not rescue a thin venue by widening the window', () => {
    // Burlington's two events stay sparse whether the window is 90 or 180 days.
    expect(assessCoverage(market(MEASURED.burlington), 180).sparse).toBe(true)
  })

  it('treats a window below the pipeline minimum as the shortest real search', () => {
    // The pipeline validates 7-180 before calling, so this only guards the
    // divisor. The assertion is the equivalence, not the verdict: two events in
    // a seven-day window is a plausible carried-calendar rate, so a degenerate
    // window is allowed to read as covered — what it must not do is divide by
    // something near zero and report an absurd rate.
    const degenerate = assessCoverage(market(MEASURED.burlington), 0)
    expect(degenerate).toEqual(assessCoverage(market(MEASURED.burlington), 7))
    expect(degenerate.peak_venue_rate).toBeLessThan(10)
  })
})

describe('the note explains the mechanism rather than the symptom', () => {
  it('names ticketing as the reason when venues exist but are thin', () => {
    const note = coverageNote(assessCoverage(market(MEASURED.burlington), 90), 50)
    expect(note).toContain('2 venues')
    expect(note).toContain('within 50 miles')
    expect(note).toMatch(/their own site/)
  })

  it('distinguishes an empty market from a thin one', () => {
    const empty = coverageNote(assessCoverage([], 90), 50)
    const thin = coverageNote(assessCoverage(market(MEASURED.burlington), 90), 50)
    expect(empty).toContain('no venues')
    // The point of the empty-market wording: absence of listings is not
    // absence of shows.
    expect(empty).toMatch(/nothing is booked/)
    expect(empty).not.toEqual(thin)
  })

  it('says nothing when coverage looks normal', () => {
    expect(coverageNote(assessCoverage(market(MEASURED.madison), 90), 50)).toBeNull()
  })
})
