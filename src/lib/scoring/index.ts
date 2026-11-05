/**
 * Scoring — a learned model over measured evidence.
 *
 * Three generations lived here. The history matters because each failure came
 * from assuming rather than measuring.
 *
 * 1. Two disjoint formulas. Membership in a 56-entry keyword array set a 7.0
 *    floor, so a listed band with no evidence outscored an unlisted band with
 *    four jam songs, a signature song and a top-ranked "jam band" tag — 7.0
 *    against 5.3.
 *
 * 2. Hand-assigned additive points, with each tag weighted by its share of the
 *    artist's top tag. That share term buried the Grateful Dead at 3.7/10:
 *    their "Jam" tag has count 10 against "Psychedelic Rock" at 100. Gov't
 *    Mule, Billy Strings and Tedeschi Trucks failed the same way. Testing the
 *    assumption showed it was backwards — zero of 25 non-jam acts carried a
 *    jam tag at any count, so presence is nearly conclusive and rank is close
 *    to irrelevant.
 *
 * 3. This. Weights learned from 440 labelled artists, with similarity-graph
 *    features added because tags describe surface genre while the jam scene is
 *    defined by who plays with whom. See scoring/model.ts.
 *
 * The score is a calibrated probability times ten: 6.2 means the model puts the
 * artist at 62% likely to be a jam act, not an arbitrary point total.
 */

import type { LastFmData } from '@/lib/sources/lastfm'
import type { SetlistData } from '@/lib/sources/setlistfm'
import type { ResolvedArtist } from '@/lib/sources/musicbrainz'
import { runModel, DISPLAY_THRESHOLD, type FeatureContribution } from './model'

export { DISPLAY_THRESHOLD, MODEL_METRICS, MODEL_VERSION } from './model'

/** Scores below the display cut but above this are shown as weaker evidence. */
export const MARGINAL_THRESHOLD = Math.max(DISPLAY_THRESHOLD - 1.5, 0.5)

export type ScoringInput = {
  artistName: string
  resolved: ResolvedArtist | null
  lastfm: LastFmData
  setlist: SetlistData
}

export type SignalContribution = {
  key: string
  label: string
  /** Share of the total positive evidence, 0–1. */
  weight: number
  detail: string | null
}

export type ScoringResult = {
  score: number
  probability: number
  label: string
  contributions: SignalContribution[]
  signalCount: number
  reasons: string[]
  notableSongs: string[]
  attributionUrl: string | null
  nameAmbiguous: boolean
  surfaces: boolean
}

const BANDS = [
  { min: 8.0, label: 'Strong jam signal' },
  { min: 6.0, label: 'Likely jam band' },
  { min: 4.0, label: 'Jam-adjacent' },
  { min: 2.0, label: 'Possible fit' },
  { min: 0, label: 'Weak signal' },
] as const

export function scoreArtist(input: ScoringInput): ScoringResult {
  const { resolved, lastfm, setlist } = input

  // Last.fm is name-addressed and cannot tell the Connecticut jam band Goose
  // from the Belgian electro act, for which it returns "electronic, new rave".
  // Where MusicBrainz says several artists share the name and Last.fm shows no
  // jam signal, its tags are withheld rather than read as evidence against the
  // band. Similar artists are kept — in the repeated-split evaluation they
  // survived the wrong-artist case better than tags did.
  const nameAmbiguous =
    resolved?.ambiguous === true &&
    lastfm.jamTagStrength < 0.05 &&
    lastfm.similarityAffinity < 0.1

  const output = runModel({
    tags: nameAmbiguous ? [] : lastfm.tags,
    similar: lastfm.similar,
    coreCoversPerShow: setlist.found ? setlist.jamCoversPerShow : null,
    showsWithCover: setlist.found ? setlist.showsWithJamCover : null,
    jamDisambiguation: resolved?.jamDisambiguation ?? false,
    setlistResolved: setlist.found,
  })

  return {
    score: output.score,
    probability: output.probability,
    label: BANDS.find((b) => output.score >= b.min)?.label ?? 'Weak signal',
    contributions: toContributions(output.contributions),
    signalCount: output.contributions.filter((c) => c.logOdds > 0).length,
    reasons: buildReasons({ lastfm, setlist, resolved, nameAmbiguous, output }),
    notableSongs: setlist.notableSongs,
    attributionUrl: setlist.found ? setlist.attributionUrl : null,
    nameAmbiguous,
    surfaces: output.surfaces,
  }
}

/**
 * Turns log-odds into shares of the positive evidence.
 *
 * Log-odds do not sum to the score, so presenting them as "points out of a
 * maximum" would misstate the arithmetic. Shares of the positive evidence are
 * true, and answer what the UI is actually asking: what made this one high?
 */
function toContributions(contributions: FeatureContribution[]): SignalContribution[] {
  const positive = contributions.filter((c) => c.logOdds > 0)
  const total = positive.reduce((sum, c) => sum + c.logOdds, 0)
  if (total <= 0) return []

  return positive
    .map((c) => ({
      key: c.family,
      label: c.label,
      weight: Number((c.logOdds / total).toFixed(3)),
      detail: c.detail,
    }))
    .sort((a, b) => b.weight - a.weight)
}

/** Plain statements of what was measured. Nothing here is generated prose. */
function buildReasons(args: {
  lastfm: LastFmData
  setlist: SetlistData
  resolved: ResolvedArtist | null
  nameAmbiguous: boolean
  output: ReturnType<typeof runModel>
}): string[] {
  const { setlist, resolved, nameAmbiguous, output } = args
  const reasons: string[] = []

  const tags = output.contributions.find((c) => c.family === 'tags')
  if (tags && tags.logOdds > 0 && tags.detail) {
    reasons.push(`Tagged ${tags.detail} on Last.fm`)
  }

  const graph = output.contributions.find((c) => c.family === 'graph')
  if (graph && graph.logOdds > 0 && graph.detail) {
    reasons.push(`Listeners place them ${graph.detail}`)
  }

  if (resolved?.jamDisambiguation && resolved.disambiguation) {
    reasons.push(`MusicBrainz describes them as a ${resolved.disambiguation.toLowerCase()}`)
  }

  if (setlist.coveredActs.length > 0) {
    const rate = Math.round(setlist.showsWithJamCover * 100)
    reasons.push(`Covers ${setlist.coveredActs.slice(0, 2).join(' and ')} in ${rate}% of recent shows`)
  }

  if (setlist.notableSongs.length > 0) {
    reasons.push(`Played ${setlist.notableSongs.slice(0, 3).join(', ')} across ${setlist.showsAnalyzed} shows`)
  }

  if (nameAmbiguous && reasons.length > 0) {
    reasons.push('Several artists share this name, so genre tags could not be matched reliably')
  }

  return reasons
}
