// Tier 1 — specific, named jam acts we know are legit.
// Any event matching these is pre-scored around 7.0 before enrichment.
export const TIER_1_KEYWORDS = [
  // The Dead family — originals
  'grateful dead',
  'dead & company',
  'dead and company',
  'jerry garcia band',
  'phil lesh',
  'bob weir',
  'wolf bros',
  'ratdog',
  'furthur',
  'the other ones',
  'mickey hart',
  'hot tuna',
  'new riders of the purple sage',

  // GD tributes & offshoots — verified acts
  'dark star orchestra',
  'terrapin flyer',
  'dead set',
  'joe russo',
  'grahame lesh',
  'john kadlecik',
  'melvin seals',
  'les claypool',

  // Established jam scene — undisputed
  'phish',
  'trey anastasio',
  'widespread panic',
  'string cheese incident',
  'govt mule',
  'government mule',
  'allman brothers',
  'allman betts',
  'tedeschi trucks',
  'umphrees mcgee',
  "umphreys mcgee",
  'disco biscuits',
  'moe.',
  'leftover salmon',
  'yonder mountain string band',
  'railroad earth',
  'greensky bluegrass',
  'billy strings',

  // Next-gen jam — well established
  'goose',
  'twiddle',
  'pigeons playing ping pong',
  'marcus king',
  'big something',
  'spafford',
  'neighbor',
  'eggy',
  'aqueous',
  'lespecial',

  // Blues/roots/southern rock crossover — strong jam credentials
  'north mississippi allstars',
  'drive-by truckers',
  'robert randolph',
  'galactic',
  'dumpstaphunk',
  'new mastersounds',
  'soulive',
] as const

// Tier 2 — vague descriptors and partial names.
// Cast a wider net but results need Spotify or Setlist validation to surface.
// Pre-scored at 3.0 — only shown to users if enrichment confirms relevance.
export const TIER_2_KEYWORDS = [
  'grateful',       // catches "Grateful Dudes", local tribute acts
  'garcia',         // "Garcia's Hat", "Garcia Project"
  'dead tribute',
  'jerry night',
  'dead night',
  'space your face',
  'terrapin',       // venue nights + some tribute acts
  'shakedown',      // show names sometimes use this
] as const

export type KeywordTier = 1 | 2

export function getKeywordTier(keyword: string): KeywordTier {
  if ((TIER_1_KEYWORDS as readonly string[]).includes(keyword)) return 1
  return 2
}
