/**
 * How strict a search should be, as a user's choice rather than the app's.
 *
 * The model answers "is this a jam act?" with a calibrated probability. What a
 * listener actually wants to know is "should I go to this show?", and those
 * come apart on the contested acts — the thirty artists labelled `borderline`
 * and held out of fitting because no honest label exists for them. Twenty-three
 * of the thirty clear the shipped threshold. Whether Dave Matthews Band, Joe
 * Bonamassa or Blackberry Smoke belongs on a Deadhead's results page is a
 * question about taste, not about accuracy, and the model is not wrong for
 * surfacing them. One global cut cannot serve someone who wants only the real
 * thing and someone who wants wide discovery.
 *
 * Because the score is a probability times ten, offering the choice is nearly
 * free. Measured over the labelled set:
 *
 *   cut     jam acts   contested   non-jam   precision
 *   >= 7.0    78/140           0         0      100.0%
 *   >= 6.0   102/140           3         0      100.0%
 *   >= 3.6   138/140          23        15       90.2%   (learned threshold)
 *
 * ── Methods that were tried and rejected ───────────────────────────────────
 *
 * Filtering by the *kind* of evidence instead of the amount looked like the
 * better idea: "plays the canon" (setlist cover attribution) against "in the
 * scene" (similarity graph) against "sounds adjacent" (tags alone). Measured,
 * it does almost nothing. Graph evidence is present for 93% of artists and
 * live evidence for 79%, so requiring either admits 21 and 23 of the 30
 * contested acts respectively — indistinguishable from the 23 that the plain
 * threshold admits. Requiring tags alone, with neither of the others, admits
 * nothing at all, because almost nobody has only tags.
 *
 * Retuning the model or moving the shipped threshold by hand was rejected
 * first: the 3.6 cut is learned as the highest-recall point holding precision
 * at or above 90%, and overriding it discards that calibration for everyone to
 * serve one preference.
 */

import { DISPLAY_THRESHOLD } from './model'

export type ApertureName = 'strict' | 'balanced' | 'wide'

export type Aperture = {
  name: ApertureName
  /** Minimum score to surface. */
  minScore: number
  /** Shown in the control. */
  label: string
  /** What choosing this does, in terms of the measurement above. */
  description: string
}

/**
 * How far below the cut an artist is still worth showing as weaker evidence.
 *
 * Relative to the chosen cut, not absolute. Held as a constant against the
 * shipped threshold it would make the "weaker signal" section swallow
 * everything between 2.1 and 7.0 in strict mode, which is the opposite of what
 * the mode is for.
 */
export const MARGINAL_BAND = 1.5

export const APERTURES: Record<ApertureName, Aperture> = {
  strict: {
    name: 'strict',
    minScore: 7.0,
    label: 'Jam bands only',
    description:
      'Admits no contested or non-jam act in the labelled set, at the cost of about four in ten real ones.',
  },
  balanced: {
    name: 'balanced',
    minScore: DISPLAY_THRESHOLD,
    label: 'Jam and adjacent',
    description:
      'The learned threshold — the highest recall that holds precision at 90%.',
  },
  wide: {
    name: 'wide',
    minScore: Math.max(DISPLAY_THRESHOLD - MARGINAL_BAND, 0.5),
    label: 'Anything plausible',
    description: 'Includes the weaker-evidence band, usually regional acts with thin reference data.',
  },
}

export const DEFAULT_APERTURE: ApertureName = 'balanced'

/** Reads an aperture from a URL parameter, falling back rather than throwing. */
export function parseAperture(value: string | undefined | null): ApertureName {
  if (value === 'strict' || value === 'balanced' || value === 'wide') return value
  return DEFAULT_APERTURE
}

/** The floor of the weaker-evidence band for a given cut. */
export const marginalFloor = (minScore: number): number =>
  Math.max(minScore - MARGINAL_BAND, 0.5)
