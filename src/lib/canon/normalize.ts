/**
 * One normaliser for every name and title comparison in the app.
 *
 * The previous implementation kept ASCII apostrophes but stripped the Unicode
 * right single quote (U+2019). Setlist.fm uses both, so the same song title
 * produced two different keys and matching depended on which character the
 * source happened to use — "Franklin's Tower" missed while "Franklin’s Tower"
 * hit. Apostrophes are now removed entirely, which makes both spellings
 * converge and removes the need to hand-maintain two variants of every title.
 */

/** Unicode quote characters that appear in real setlist and artist data. */
const QUOTES = /['‘’ʼ′`´]/g

/** Leading article, which sources include inconsistently ("The Band" / "Band"). */
const LEADING_ARTICLE = /^(?:the|a|an)\s+/

/**
 * Lowercases, strips accents, removes apostrophes, reduces everything else to
 * single-spaced alphanumerics.
 *
 *   normalize("Franklin's Tower")  === "franklins tower"
 *   normalize("Franklin’s Tower") === "franklins tower"
 *   normalize("  Scarlet—Begonias ") === "scarlet begonias"
 */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining accents
    .toLowerCase()
    .replace(QUOTES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * `normalize` plus a dropped leading article, for comparing entity names across
 * sources. Ticketmaster says "The String Cheese Incident" where Last.fm says
 * "String Cheese Incident".
 */
export function normalizeName(input: string): string {
  return normalize(input).replace(LEADING_ARTICLE, '')
}

/**
 * Strips the promotional noise Ticketmaster packs into event titles so the
 * performer can be matched against music databases.
 *
 *   "Goose - Summer Tour 2026"              -> "goose"
 *   "An Evening with Phish (2 Night Pass)"  -> "phish"
 *   "Billy Strings w/ Special Guest"        -> "billy strings"
 */
export function extractPerformerName(eventTitle: string): string {
  let title = eventTitle

  // Drop anything in brackets — almost always ticketing or billing detail.
  title = title.replace(/[([{][^)\]}]*[)\]}]/g, ' ')

  // Cut at a separator that introduces tour/support/billing text.
  const SEPARATORS = [
    /\s[-–—]\s/, / \| /, /\swith\s/i, /\sw\/\s/i, /\sfeat\.?\s/i, /\sfeaturing\s/i,
    /\spresents\s/i, /\spresented by\s/i, /:\s/,
  ]
  for (const sep of SEPARATORS) {
    const match = title.match(sep)
    if (match?.index !== undefined && match.index > 2) title = title.slice(0, match.index)
  }

  // Remove framing phrases and trailing tour/year labels.
  title = title
    .replace(/^(?:an?\s+)?evening\s+with\s+/i, '')
    .replace(/^the\s+music\s+of\s+/i, '')
    .replace(/\s+(?:live|tour|world tour|summer tour|fall tour|winter tour|spring tour)\b.*$/i, '')
    .replace(/\s+20\d{2}\b.*$/, '')

  return title.replace(/\s+/g, ' ').trim() || eventTitle.trim()
}
