/**
 * The learned scoring model.
 *
 * ── Why this replaced hand-tuned weights ───────────────────────────────────
 *
 * The previous model split tags into DIRECT and ADJACENT by hand and scaled
 * each by its share of the artist's top tag. That share term buried the
 * Grateful Dead at 3.7/10: their "Jam" tag has count 10 against "Psychedelic
 * Rock" at 100, so the strongest possible evidence read as 0.1.
 *
 * Testing the assumption showed it was backwards. Across the labelled set, zero
 * non-jam acts carried a jam tag at any count while almost every jam act did —
 * presence is nearly conclusive and rank is close to irrelevant, because
 * Last.fm tag counts are dominated by whichever generic genre also applies.
 *
 * The metric hid it too. All four tag formulations scored AUC 0.950, because
 * AUC is threshold-free and they rank identically; their recall at the cut that
 * actually ships ranged from 73% to 97%. Evaluation is now precision and recall
 * at the operating point, averaged over repeated stratified splits.
 *
 * ── What the model is ──────────────────────────────────────────────────────
 *
 * L2-regularised logistic regression over three feature families:
 *
 *   tags   binary presence of each Last.fm tag (vocabulary and weights learned
 *          from data, minimum support 4 artists)
 *   graph  how much of an artist's Last.fm similar-artist neighbourhood sits
 *          inside the jam scene, against a precomputed affinity table
 *   live   setlist.fm cover attribution and MusicBrainz disambiguation
 *
 * The graph family is what tags cannot do. The scene is defined by who plays
 * with whom, not by genre: TAUK is tagged "jazz, fusion" like fifty non-jam
 * jazz acts but sits beside Lettuce and Dopapod in the graph. Measured alone,
 * tags reach 73% recall and the graph 87.6%; together, 94.2%.
 *
 * Weights, threshold and the override live in `model.generated.json`, produced
 * by `scripts/fit-model.ts` from the committed fixture and checked in, so
 * scoring is reproducible and reviewable and the app has no training-time
 * dependency.
 */

import weightsJson from './model.generated.json'
import affinityJson from './affinity.generated.json'
import { normalizeName } from '@/lib/canon/normalize'

type ModelArtifact = {
  version: string
  trainedAt: string
  threshold: number
  coverOverride: { coversPerShow: number; probability: number }
  bias: number
  tagWeights: Record<string, number>
  graphWeights: Record<string, number>
  liveWeights: Record<string, number>
  metrics: {
    splits: number
    precision: { mean: number; sd: number }
    recall: { mean: number; sd: number }
  }
}

const MODEL = weightsJson as ModelArtifact

/**
 * Jam-scene affinity per artist, 0–1.
 *
 * Built offline by expanding one hop from the curated jam acts across Last.fm's
 * similarity graph. 1.0 is a curated act; lower values are neighbours, weighted
 * by similarity and by how many jam acts they neighbour.
 */
const AFFINITY = affinityJson as Record<string, number>

export type ModelFeatures = {
  tags: string[]
  similar: Array<{ name: string; match: number }>
  /** Jam-canon covers per show from setlist.fm, or null when unavailable. */
  coreCoversPerShow: number | null
  /** Share of recent shows containing a jam-canon cover, or null. */
  showsWithCover: number | null
  jamDisambiguation: boolean
  setlistResolved: boolean
}

export type FeatureContribution = {
  family: 'tags' | 'graph' | 'live'
  label: string
  /** Log-odds contributed. Negative values push away from jam. */
  logOdds: number
  detail: string | null
}

export type ModelOutput = {
  /** Calibrated probability that this is a jam act, 0–1. */
  probability: number
  /** 0–10 for display: the probability times ten, nothing else. */
  score: number
  surfaces: boolean
  /** The cover-attribution rule fired, bypassing the learned probability. */
  overridden: boolean
  contributions: FeatureContribution[]
  available: { tags: boolean; graph: boolean; live: boolean }
}

/** Jam-scene density of an artist's similar-artist neighbourhood. */
export function graphFeatures(similar: ModelFeatures['similar']) {
  let weighted = 0
  let total = 0
  let neighbours = 0
  let best = 0
  const named: string[] = []

  for (const s of similar) {
    const affinity = AFFINITY[normalizeName(s.name)] ?? 0
    total += s.match
    if (affinity > 0) {
      weighted += s.match * affinity
      neighbours++
      if (affinity > best) best = affinity
      if (affinity >= 0.9) named.push(s.name)
    }
  }

  return {
    jamShare: total > 0 ? weighted / total : 0,
    jamNeighbours: Math.min(neighbours / 20, 1),
    bestNeighbour: best,
    /** Curated jam acts in the neighbourhood, for the explanation. */
    namedNeighbours: named.slice(0, 4),
    hasData: similar.length > 0,
  }
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

/**
 * Applies the model and reports what drove the result.
 *
 * The cover-attribution override is a rule rather than a feature on purpose. A
 * band playing most of a Grateful Dead set every night is a Dead act whatever
 * Last.fm says — Cubensis averages 8.45 attributed Dead covers per show and
 * Last.fm files it under thrash metal. On the labelled set every artist above
 * the cover threshold was a jam act (30 of 30), and the floor probability is
 * the Wilson lower bound on that, not 1.0.
 *
 * The alternative — relaxing regularisation so the model could learn this from
 * the feature itself — was tested first and performed slightly worse.
 */
export function runModel(features: ModelFeatures): ModelOutput {
  const contributions: FeatureContribution[] = []
  let logOdds = MODEL.bias

  // ── tags ────────────────────────────────────────────────────────────────
  const tags = new Set(features.tags.map((t) => t.toLowerCase().trim()))
  const hits: Array<{ tag: string; w: number }> = []
  for (const tag of tags) {
    const w = MODEL.tagWeights[tag]
    if (w === undefined) continue
    logOdds += w
    hits.push({ tag, w })
  }
  hits.sort((a, b) => b.w - a.w)
  if (hits.length > 0) {
    contributions.push({
      family: 'tags',
      label: 'Genre tags',
      logOdds: hits.reduce((sum, t) => sum + t.w, 0),
      detail: hits.filter((t) => t.w > 0).slice(0, 3).map((t) => t.tag).join(', ') || null,
    })
  }

  // ── graph ───────────────────────────────────────────────────────────────
  const g = graphFeatures(features.similar)
  const graphTotal =
    (MODEL.graphWeights.jamShare ?? 0) * g.jamShare +
    (MODEL.graphWeights.jamNeighbours ?? 0) * g.jamNeighbours +
    (MODEL.graphWeights.bestNeighbour ?? 0) * g.bestNeighbour
  logOdds += graphTotal
  if (g.hasData) {
    contributions.push({
      family: 'graph',
      label: 'Listener neighbourhood',
      logOdds: graphTotal,
      detail:
        g.namedNeighbours.length > 0
          ? `beside ${g.namedNeighbours.slice(0, 2).join(' and ')}`
          : g.jamNeighbours > 0
            ? 'next to the jam scene'
            : null,
    })
  }

  // ── live evidence ───────────────────────────────────────────────────────
  const coversPerShow = features.coreCoversPerShow ?? 0
  const coverShare = clamp01(features.showsWithCover ?? 0)
  const liveTotal =
    (MODEL.liveWeights.coreCovers ?? 0) * clamp01(coversPerShow / 2) +
    (MODEL.liveWeights.showsWithCore ?? 0) * coverShare +
    (MODEL.liveWeights.mbJam ?? 0) * (features.jamDisambiguation ? 1 : 0) +
    (MODEL.liveWeights.setlistResolved ?? 0) * (features.setlistResolved ? 1 : 0)
  logOdds += liveTotal

  const overridden = coversPerShow >= MODEL.coverOverride.coversPerShow
  if (features.setlistResolved || features.jamDisambiguation) {
    contributions.push({
      family: 'live',
      label: 'Live evidence',
      logOdds: liveTotal,
      detail: overridden
        ? `${coversPerShow.toFixed(1)} jam-canon covers per show`
        : features.jamDisambiguation
          ? 'MusicBrainz lists them as a jam act'
          : coverShare > 0
            ? `jam covers in ${Math.round(coverShare * 100)}% of recent shows`
            : null,
    })
  }

  const learned = 1 / (1 + Math.exp(-logOdds))
  const probability = overridden ? Math.max(learned, MODEL.coverOverride.probability) : learned

  return {
    probability,
    score: Number((probability * 10).toFixed(1)),
    surfaces: probability >= MODEL.threshold,
    overridden,
    contributions: contributions.sort((a, b) => b.logOdds - a.logOdds),
    available: { tags: tags.size > 0, graph: g.hasData, live: features.setlistResolved },
  }
}

/** The learned operating threshold, as a 0–10 score. */
export const DISPLAY_THRESHOLD = Number((MODEL.threshold * 10).toFixed(1))

export const MODEL_METRICS = MODEL.metrics
export const MODEL_VERSION = MODEL.version
export const MODEL_TRAINED_AT = MODEL.trainedAt
