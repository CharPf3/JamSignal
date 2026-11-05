/**
 * Every tunable in the scoring model, in one place.
 *
 * Weights are derived from measured discriminative power on a labelled set of
 * 55 artists — 30 jam acts and 25 country/folk/blues acts that appear in the
 * same Ticketmaster searches. AUC is the probability that a random jam act
 * outranks a random non-jam act on that signal alone: 0.5 is a coin flip.
 *
 *   Last.fm rank-weighted jam tags      0.957
 *   Last.fm similar-artist affinity     0.923
 *   setlist.fm jam covers per show      0.811
 *   setlist.fm % shows with jam cover   0.803
 *   Ticketmaster genre classification   0.611   <- not used
 *   setlist.fm songs per show           0.318   <- actively misleading
 *
 * Ticketmaster is excluded from scoring entirely. At 0.611 it barely separates
 * the groups, and the reason is visible in the raw data: the most common
 * classification for jam acts and non-jam acts alike is "Rock/Pop". Jam bands
 * have no home in that taxonomy. Ticketmaster's job is finding out who is
 * playing nearby, which nothing else can do, and that is all it is used for.
 *
 * ── Why the model is additive ──────────────────────────────────────────────
 *
 * Only one signal has informative absence: Last.fm tags. A well-documented band
 * with no jam tags genuinely is not a jam band. Every other signal is
 * positive-only, because its absence is explained by something other than the
 * band not being jammy:
 *
 *   covers      the jammiest bands cover least — they play originals. Trey
 *               Anastasio averages 17.07 jam covers per show; Widespread Panic
 *               0.07 and the Disco Biscuits 0.00. All three are jam bands.
 *   canon/sig   same reason.
 *   MusicBrainz most entries carry no genre description at all. Phish's reads
 *               "American rock band formed in Burlington, Vermont, in 1983".
 *   known act   a curated list cannot be exhaustive; that is the whole problem
 *               it was failing to solve.
 *
 * So the score is the tag term plus bounded positive bonuses. Treating a
 * positive-only signal as a weighted term that can read zero penalises bands
 * for gaps in reference data rather than for lacking evidence.
 */

/**
 * Maximum points each signal can contribute. The total exceeds 10 on purpose —
 * an act with overwhelming evidence from every direction saturates at the top,
 * which is the correct behaviour for Phish.
 */
export const POINTS = {
  /** Rank-weighted direct jam tags. Strongest measured signal. */
  jamTags: 5.0,
  /** Proximity to seed jam acts in Last.fm's similarity graph. */
  similarity: 2.5,
  /** Jam-canon cover attribution from setlist.fm. */
  covers: 1.5,
  /** MusicBrainz disambiguation text naming the act a jam band. */
  disambiguation: 1.5,
  /**
   * Curated known-acts list. Deliberately small: the previous model gave list
   * membership a 7.0 floor, which outweighed every measured signal combined —
   * a band with four jam songs, a signature song and a top-ranked "jam band"
   * tag scored 5.3 while a band on the list with no evidence scored 7.0.
   */
  knownAct: 1.0,
  /** Distinct canon originals per show. */
  canonSongs: 0.8,
  /** Signature improvisational vehicles (Dark Star, YEM, Elizabeth Reed). */
  signatureSongs: 0.7,
  /** Adjacent genre tags. Weak evidence, capped low. */
  adjacentTags: 0.8,
} as const

/** Values at which a raw signal is considered fully saturated. */
export const SATURATION = {
  /**
   * Summed Last.fm similarity to seed acts. Jam acts averaged 3.19 and non-jam
   * 0.27, so 4.0 is a confident ceiling rather than an outlier.
   */
  similarityAffinity: 4.0,
  /** Jam-canon covers per show. Jam acts averaged 1.50, non-jam 0.04. */
  jamCoversPerShow: 1.5,
  /** Distinct canon originals per show. */
  canonSongsPerShow: 3.0,
} as const

/**
 * Below this share of the artist's top-tag weight, a jam tag is noise rather
 * than signal.
 *
 * Last.fm pages for ambiguous names are merged entities. Its "Goose" page is
 * dominated by the Belgian electro act yet carries a 1% trickle of "jam band"
 * from the Connecticut band's listeners. That trickle is indistinguishable from
 * a few stray votes, so it does not count as the tag signal being reliable.
 */
export const AMBIGUOUS_TAG_FLOOR = 0.05

/** Minimum score to surface in results. */
export const DISPLAY_THRESHOLD = 2.5

/** Score bands used for labelling in the UI. */
export const BANDS = [
  { min: 8.0, label: 'Strong jam signal' },
  { min: 6.0, label: 'Likely jam band' },
  { min: 4.0, label: 'Jam-adjacent' },
  { min: 2.5, label: 'Possible fit' },
  { min: 0, label: 'Weak signal' },
] as const
