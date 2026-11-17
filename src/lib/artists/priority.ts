/**
 * Which artists to analyse first when the budget cannot cover them all.
 *
 * Ordering matters more than it looks. A first attempt sorted the pending
 * artists alphabetically — deterministic, which was the point, but it spent all
 * twelve slots of a Madison search on "almost monday", "Aly & AJ", "Andrea
 * Gibson" and "Avery Anna" while STS9, Kitchen Dwellers, Fruition and Victor
 * Wooten sat unanalysed. Determinism without prioritisation is just a different
 * arbitrary answer.
 *
 * Everything here is free: no API call, only the name and the listing text.
 * Ties break alphabetically so the order stays stable across runs.
 */

import { isKnownAct, isSeedAct } from '@/lib/canon/acts'
import { normalize } from '@/lib/canon/normalize'

/**
 * Tokens that mark a listing as worth looking at. Tribute nights, residencies
 * and genre billings are where unlisted local acts announce themselves.
 */
const HINT_TOKENS: Array<[token: string, weight: number]> = [
  ['grateful dead', 40],
  ['dead and company', 40],
  ['jam band', 35],
  ['jamgrass', 35],
  ['jerry garcia', 30],
  ['dead tribute', 30],
  ['garcia', 22],
  ['terrapin', 22],
  ['shakedown', 20],
  ['dead night', 20],
  ['jamband', 20],
  ['improv', 16],
  ['tribute', 12],
  ['bluegrass', 12],
  ['newgrass', 12],
  ['psychedelic', 12],
  ['allstars', 8],
  ['all stars', 8],
  ['jam', 8],
  ['funk', 6],
  ['string band', 6],
]

/** Listings that are plainly not live music. */
const EXCLUDE_TOKENS = [
  'harlem globetrotters', 'monster jam', 'trivia', 'comedy', 'podcast',
  'book tour', 'speaking', 'lecture', 'on ice', 'wrestling', 'rodeo',
]

export type PriorityInput = {
  artistName: string
  /** The listing title, which often carries more signal than the artist name. */
  eventTitle?: string
  tmSubgenre?: string | null
}

/**
 * A cheap prior, higher first. Not a score — only a queue order.
 *
 * Deliberately crude: its only job is to make sure a seeded or obviously
 * jam-flavoured listing is analysed before an unrelated pop act, so that a
 * budget-limited search spends itself usefully.
 */
export function candidatePriority(input: PriorityInput): number {
  const name = normalize(input.artistName)
  const haystack = normalize(`${input.artistName} ${input.eventTitle ?? ''} ${input.tmSubgenre ?? ''}`)

  if (EXCLUDE_TOKENS.some((token) => haystack.includes(token))) return -100

  let score = 0
  if (isSeedAct(input.artistName)) score += 100
  else if (isKnownAct(input.artistName)) score += 80

  for (const [token, weight] of HINT_TOKENS) {
    if (haystack.includes(token)) score += weight
  }

  // A listing whose title differs from the performer name is usually a themed
  // night or billing — slightly more likely to be scene-relevant than a bare
  // headliner booking.
  if (input.eventTitle && normalize(input.eventTitle) !== name) score += 2

  return score
}

/** Orders candidates by prior, then alphabetically for stability. */
export function prioritize<T extends PriorityInput & { key: string }>(candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) => candidatePriority(b) - candidatePriority(a) || a.key.localeCompare(b.key)
  )
}
