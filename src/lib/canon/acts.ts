/**
 * Known jam acts.
 *
 * The old `TIER_1_KEYWORDS` array served four incompatible purposes at once:
 * Ticketmaster search terms, the scoring tier, the cover-attribution set, and
 * the similarity seeds. That coupling is why the app mostly rediscovered bands
 * it had already been told about, and why list membership was worth more than
 * every measured signal combined.
 *
 * The roles are now separate:
 *
 *   SEED_ACTS   small, undisputed core. Reference points for the two measured
 *               signals — Last.fm similar-artist affinity and setlist.fm cover
 *               attribution. Precision matters far more than coverage here;
 *               adding a marginal act pollutes both signals.
 *
 *   KNOWN_ACTS  acts we are confident about. Contributes a small prior and
 *               seeds Ticketmaster queries. Being on this list is a nudge, not
 *               a verdict — see scoring/weights.ts.
 *
 * Matching is exact on the normalised name, never substring. Substring matching
 * is what scored "Phish Food Trivia Night" and "Eggy Benedict Brunch Band" as
 * confirmed jam bands.
 */

import { normalizeName } from './normalize'

/**
 * The undisputed core. Used as reference points for measured signals, so this
 * list is deliberately short — every entry is an act whose presence in a
 * similar-artists list or a cover credit is strong evidence on its own.
 */
export const SEED_ACTS = [
  'Grateful Dead',
  'Phish',
  'Widespread Panic',
  'The Allman Brothers Band',
  'Jerry Garcia Band',
  'Goose',
  'The String Cheese Incident',
  "Umphrey's McGee",
  'Leftover Salmon',
  'The Disco Biscuits',
  'moe.',
  "Gov't Mule",
  'Trey Anastasio',
  'Billy Strings',
  'Greensky Bluegrass',
  'Railroad Earth',
  "Joe Russo's Almost Dead",
  'Dark Star Orchestra',
  'Tedeschi Trucks Band',
  'The Infamous Stringdusters',
] as const

/**
 * Broader set of acts we are confident about, grouped by scene for
 * maintainability. Aliases exist because Ticketmaster, Last.fm and MusicBrainz
 * spell the same act differently.
 */
const KNOWN_ACT_GROUPS = {
  deadFamily: [
    'Grateful Dead', 'Dead & Company', 'Dead and Company', 'Jerry Garcia Band',
    'Phil Lesh and Friends', 'Phil Lesh & Friends', 'Bob Weir', 'Wolf Bros',
    'Bob Weir and Wolf Bros', 'RatDog', 'Furthur', 'The Other Ones', 'Mickey Hart',
    'Mickey Hart Band', 'Hot Tuna', 'Hot Tuna Acoustic', 'New Riders of the Purple Sage',
    'Donna Jean Godchaux', 'Bill Kreutzmann', 'Billy & The Kids',
  ],
  deadAdjacent: [
    'Dark Star Orchestra', "Joe Russo's Almost Dead", 'JRAD', 'Terrapin Flyer',
    'Melvin Seals', 'Melvin Seals & JGB', 'JGB', 'Grahame Lesh', 'Midnight North',
    'John Kadlecik', 'Cubensis', 'Shakedown', 'China Cats', 'Stu Allen',
    'Phil Lesh', 'Oteil Burbridge', 'Jeff Chimenti',
  ],
  established: [
    'Phish', 'Trey Anastasio', 'Trey Anastasio Band', 'TAB', 'Mike Gordon',
    'Page McConnell', 'Widespread Panic', 'The String Cheese Incident',
    'String Cheese Incident', "Umphrey's McGee", "Gov't Mule", 'Government Mule',
    'The Allman Brothers Band', 'Allman Betts Band', 'The Allman Betts Band',
    'Tedeschi Trucks Band', 'Derek Trucks', 'Susan Tedeschi', 'The Disco Biscuits',
    'moe.', 'Leftover Salmon', 'Yonder Mountain String Band', 'Railroad Earth',
    'Greensky Bluegrass', 'Billy Strings', 'The Infamous Stringdusters',
    'Keller Williams', 'Steve Kimock', 'Les Claypool',
  ],
  nextGen: [
    'Goose', 'Twiddle', 'Pigeons Playing Ping Pong', 'Spafford', 'Neighbor',
    'Eggy', 'Aqueous', 'lespecial', 'Dogs in a Pile', 'Kitchen Dwellers',
    'Big Something', 'The Main Squeeze', 'Dopapod', 'Mihali', 'Melt',
    'Daniel Donato', "Daniel Donato's Cosmic Country", 'Magic Beans',
    'Andy Frasco', 'Andy Frasco & The U.N.', 'Cycles', 'Sunsquabi',
    'The Fritz', 'Chemical X', 'Lotus', 'Papadosio', 'Tauk', 'Mungion',
  ],
  rootsCrossover: [
    'North Mississippi Allstars', 'Robert Randolph', 'Robert Randolph & The Family Band',
    'Galactic', 'Dumpstaphunk', 'The New Mastersounds', 'Soulive', 'Lettuce',
    'The Motet', 'Karl Denson', "Karl Denson's Tiny Universe", 'The Nth Power',
    'Fruition', 'Armchair Boogie', 'The Travelin McCourys', 'Sam Bush',
    'Peter Rowan', 'Del McCoury Band', 'The Del McCoury Band',
  ],
} as const

export const KNOWN_ACTS: readonly string[] = Object.values(KNOWN_ACT_GROUPS).flat()

/**
 * Ticketmaster query seeds.
 *
 * Deliberately far smaller than KNOWN_ACTS. Ticketmaster allows 5 requests per
 * second; the old code issued 62 at once and silently lost a third of them to
 * 429s, which is why two identical searches returned different results. Real
 * discovery comes from genre classification sweeps (see sources/ticketmaster.ts)
 * — these name queries only catch headliners whose classification is unhelpful.
 */
export const SEARCH_SEEDS: readonly string[] = [
  'grateful dead tribute',
  'dead and company',
  'jam band',
  'jamgrass',
  'phish tribute',
]

const SEED_SET = new Set(SEED_ACTS.map(normalizeName))
const KNOWN_SET = new Set(KNOWN_ACTS.map(normalizeName))

/** Exact normalised-name membership in the undisputed core. */
export const isSeedAct = (name: string): boolean => SEED_SET.has(normalizeName(name))

/** Exact normalised-name membership in the broader known-acts list. */
export const isKnownAct = (name: string): boolean => KNOWN_SET.has(normalizeName(name))

/**
 * Phrases that appear in MusicBrainz `disambiguation` text for jam acts —
 * "Norwalk, Connecticut jam band", "New England jam band". Human-curated and
 * high precision, so worth reading directly.
 */
const DISAMBIGUATION_MARKERS = [
  'jam band', 'jamband', 'jam rock', 'jamgrass', 'jam-grass',
  'grateful dead', 'dead tribute', 'improvisational', 'newgrass',
] as const

/** Whether a MusicBrainz disambiguation string identifies a jam act. */
export function disambiguationSuggestsJam(disambiguation: string | null): boolean {
  if (!disambiguation) return false
  const lower = disambiguation.toLowerCase()
  return DISAMBIGUATION_MARKERS.some((marker) => lower.includes(marker))
}
