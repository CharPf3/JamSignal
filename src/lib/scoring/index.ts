/**
 * Scoring — a single additive evidence model.
 *
 * The previous model had two disjoint formulas on different scales. Membership
 * in a 56-entry keyword array set a 7.0 floor, while everything else earned its
 * way up to a hard 8.5 cap, which produced the central defect:
 *
 *   on the list, no evidence at all ................. 7.0
 *   not on the list, 4 jam songs + signature + tag ... 5.3
 *
 * There is now one continuous score: the Last.fm tag term plus bounded positive
 * bonuses from each remaining signal, clamped to 10. See scoring/weights.ts for
 * why the model is additive rather than a weighted mean.
 *
 * The one piece of genuine missing-data handling is `tagsReliable`. Last.fm is
 * name-addressed and cannot distinguish the Connecticut jam band Goose from the
 * Belgian electro act of the same name — it reports "electronic, electro, new
 * rave" for Goose. Where MusicBrainz reports that several distinct artists share
 * a name and Last.fm's jam signal is negligible, the tag signal is withheld
 * rather than read as evidence against the band.
 */

import { isKnownAct } from '@/lib/canon/acts'
import type { LastFmData } from '@/lib/sources/lastfm'
import type { SetlistData } from '@/lib/sources/setlistfm'
import type { ResolvedArtist } from '@/lib/sources/musicbrainz'
import { POINTS, SATURATION, DISPLAY_THRESHOLD, BANDS, AMBIGUOUS_TAG_FLOOR } from './weights'

export type ScoringInput = {
  artistName: string
  resolved: ResolvedArtist | null
  lastfm: LastFmData
  setlist: SetlistData
}

/** One signal's contribution, exposed for display and for tuning. */
export type SignalContribution = {
  key: keyof typeof POINTS
  label: string
  /** Points contributed, 0 to POINTS[key]. */
  points: number
  /** Ceiling for this signal. */
  max: number
  /** What was measured, in plain language. Null when nothing was found. */
  detail: string | null
}

export type ScoringResult = {
  /** 0.0–10.0, continuous. */
  score: number
  label: string
  /** Signals that contributed, largest first. */
  contributions: SignalContribution[]
  /** How many distinct signals found something. */
  signalCount: number
  /** Short phrases describing the actual evidence, for the UI. */
  reasons: string[]
  /** Canon songs to show as chips. Original casing. */
  notableSongs: string[]
  /** Setlist.fm attribution, required when setlist data is shown. */
  attributionUrl: string | null
  /** True when Last.fm's name-based lookup could not be trusted. */
  nameAmbiguous: boolean
  surfaces: boolean
}

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1)
const round1 = (n: number): number => Number(n.toFixed(1))

export function scoreArtist(input: ScoringInput): ScoringResult {
  const { artistName, resolved, lastfm, setlist } = input

  // See the module comment: withhold the tag signal rather than read a
  // wrong-artist lookup as evidence of absence.
  const nameAmbiguous =
    resolved?.ambiguous === true && lastfm.jamTagStrength < AMBIGUOUS_TAG_FLOOR
  const tagsReliable = lastfm.found && !nameAmbiguous

  const known = isKnownAct(artistName) || (resolved !== null && isKnownAct(resolved.name))

  const contributions: SignalContribution[] = [
    {
      key: 'jamTags',
      label: 'Genre tags',
      max: POINTS.jamTags,
      points: tagsReliable ? clamp01(lastfm.jamTagStrength) * POINTS.jamTags : 0,
      detail: tagsReliable && lastfm.matchedTags.length > 0 ? lastfm.matchedTags.slice(0, 3).join(', ') : null,
    },
    {
      key: 'similarity',
      label: 'Similar artists',
      max: POINTS.similarity,
      points: clamp01(lastfm.similarityAffinity / SATURATION.similarityAffinity) * POINTS.similarity,
      detail: lastfm.similarSeeds.length > 0 ? lastfm.similarSeeds.slice(0, 3).join(', ') : null,
    },
    {
      key: 'covers',
      label: 'Covers played',
      max: POINTS.covers,
      // Blends intensity (covers per show) with consistency (share of shows),
      // so one Dead-heavy night does not read the same as covering them nightly.
      points:
        (0.6 * clamp01(setlist.jamCoversPerShow / SATURATION.jamCoversPerShow) +
          0.4 * clamp01(setlist.showsWithJamCover)) * POINTS.covers,
      detail: setlist.coveredActs.length > 0 ? setlist.coveredActs.slice(0, 2).join(', ') : null,
    },
    {
      key: 'disambiguation',
      label: 'MusicBrainz',
      max: POINTS.disambiguation,
      points: resolved?.jamDisambiguation ? POINTS.disambiguation : 0,
      detail: resolved?.jamDisambiguation ? resolved.disambiguation : null,
    },
    {
      key: 'knownAct',
      label: 'Curated list',
      max: POINTS.knownAct,
      points: known ? POINTS.knownAct : 0,
      detail: known ? 'on the known jam-acts list' : null,
    },
    {
      key: 'canonSongs',
      label: 'Canon songs',
      max: POINTS.canonSongs,
      points: clamp01(setlist.canonSongsPerShow / SATURATION.canonSongsPerShow) * POINTS.canonSongs,
      detail: setlist.notableSongs.length > 0 ? `${setlist.notableSongs.length} in recent sets` : null,
    },
    {
      key: 'signatureSongs',
      label: 'Signature jams',
      max: POINTS.signatureSongs,
      points: clamp01(setlist.showsWithSignature) * POINTS.signatureSongs,
      detail: setlist.showsWithSignature > 0 ? `${Math.round(setlist.showsWithSignature * 100)}% of shows` : null,
    },
    {
      key: 'adjacentTags',
      label: 'Adjacent genres',
      max: POINTS.adjacentTags,
      points: tagsReliable ? clamp01(lastfm.adjacentTagStrength / 0.35) * POINTS.adjacentTags : 0,
      detail: null,
    },
  ]

  const total = contributions.reduce((sum, c) => sum + c.points, 0)
  const score = round1(Math.min(Math.max(total, 0), 10))

  return {
    score,
    label: BANDS.find((b) => score >= b.min)?.label ?? 'Weak signal',
    contributions: contributions
      .filter((c) => c.points > 0)
      .map((c) => ({ ...c, points: round1(c.points) }))
      .sort((a, b) => b.points - a.points),
    signalCount: contributions.filter((c) => c.points > 0).length,
    reasons: buildReasons({ known, lastfm, setlist, resolved, tagsReliable, nameAmbiguous }),
    notableSongs: setlist.notableSongs,
    attributionUrl: setlist.found ? setlist.attributionUrl : null,
    nameAmbiguous,
    surfaces: score >= DISPLAY_THRESHOLD,
  }
}

/**
 * Describes the evidence in plain language.
 *
 * These are statements of what was measured, not generated prose. The old field
 * was named `ai_explanation` and rendered in italic quotation marks as though a
 * model had written it; nothing in the app called one.
 */
function buildReasons(args: {
  known: boolean
  lastfm: LastFmData
  setlist: SetlistData
  resolved: ResolvedArtist | null
  tagsReliable: boolean
  nameAmbiguous: boolean
}): string[] {
  const { known, lastfm, setlist, resolved, tagsReliable, nameAmbiguous } = args
  const reasons: string[] = []

  if (tagsReliable && lastfm.jamTagStrength > 0.1) {
    const strength = lastfm.jamTagStrength > 0.6 ? 'Widely tagged' : 'Tagged'
    reasons.push(`${strength} ${lastfm.matchedTags.slice(0, 2).join(' / ')} on Last.fm`)
  }

  if (resolved?.jamDisambiguation && resolved.disambiguation) {
    reasons.push(`MusicBrainz describes them as a ${resolved.disambiguation.toLowerCase()}`)
  }

  if (lastfm.similarSeeds.length > 0) {
    reasons.push(`Listeners group them with ${lastfm.similarSeeds.slice(0, 2).join(' and ')}`)
  }

  if (setlist.coveredActs.length > 0) {
    const rate = Math.round(setlist.showsWithJamCover * 100)
    reasons.push(`Covers ${setlist.coveredActs.slice(0, 2).join(' and ')} in ${rate}% of recent shows`)
  }

  if (setlist.notableSongs.length > 0) {
    reasons.push(`Played ${setlist.notableSongs.slice(0, 3).join(', ')} across ${setlist.showsAnalyzed} shows`)
  }

  // Only worth saying when something else points at the band; otherwise every
  // artist who happens to share a name with a namesake gets a pointless caveat.
  if (nameAmbiguous && reasons.length > 0) {
    reasons.push('Several artists share this name, so genre tags could not be matched reliably')
  }

  if (known && reasons.length === 0) {
    reasons.push('On the curated jam-acts list, but no live evidence found yet')
  }

  return reasons
}
