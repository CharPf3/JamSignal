import { TIER_1_KEYWORDS } from '@/lib/ticketmaster/keywords'
import type { ArtistGenreData } from '@/lib/spotify/client'
import type { SetlistData } from '@/lib/setlistfm/client'

// TM genres are broad (Rock, Folk, Blues) — scores top out at 5 to reflect lower specificity.
// Used as a floor when Last.fm has no data; Last.fm wins when both are present.
const TM_GENRE_SCORES: Record<string, number> = {
  'folk':        4,
  'americana':   4,
  'blues':       3,
  'country':     3,
  'rock':        2,
  'alternative': 2,
  'jazz':        2,
}

function scoreTmGenre(genre: string | null, subGenre: string | null): number {
  const sub = (subGenre ?? '').toLowerCase()
  const gen = (genre ?? '').toLowerCase()
  for (const [key, val] of Object.entries(TM_GENRE_SCORES)) {
    if (sub.includes(key)) return Math.min(val + 1, 5)
  }
  return TM_GENRE_SCORES[gen] ?? 0
}

export type ScoringInput = {
  band_name: string    // display name (event title) — shown to user
  artist_name: string  // canonical performer name — used for Tier 1 matching
  genres: ArtistGenreData
  setlist: SetlistData
  tm_genre: string | null
  tm_subgenre: string | null
}

export type ScoringResult = {
  confidence_score: number       // 0.0–10.0
  ai_explanation: string
  genre_tags: string[]
  setlist_jam_songs: string[]
  attribution_url: string | null // setlist.fm attribution (ToS requirement)
  should_run_setlist: boolean
}

// Match against the canonical artist name, not the full event title.
// Space-bounded so "neighbor" doesn't match "neighbors", "mule" doesn't match "samuel".
function matchesTier1(artistName: string): boolean {
  const lower = artistName.toLowerCase().trim()
  return TIER_1_KEYWORDS.some((kw) => {
    if (lower === kw) return true
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(lower)
  })
}

export function scoreBand(input: ScoringInput): ScoringResult {
  const { artist_name, genres, setlist, tm_genre, tm_subgenre } = input
  const isTier1 = matchesTier1(artist_name)
  const genreScore = Math.max(genres.jam_genre_score, scoreTmGenre(tm_genre, tm_subgenre))

  let confidence_score: number

  if (isTier1) {
    // Confirmed jam band — baseline 7.0.
    // 5+ jam canon songs in recent sets pushes toward 10.
    // High-signal songs (Dark Star, Reba, YEM…) add up to 0.5 more.
    const setlistBonus = (Math.min(setlist.jam_song_count, 5) / 5) * 2.5
    const highSignalBonus = Math.min(setlist.high_signal_count * 0.1, 0.5)
    confidence_score = parseFloat(Math.min(7.0 + setlistBonus + highSignalBonus, 10).toFixed(1))
  } else {
    // Discovery path — must earn the score through evidence.
    // Capped at 8.5 so discovered acts are distinguished from confirmed Tier 1 bands.
    const setlistScore = (Math.min(setlist.jam_song_count, 10) / 10) * 10
    const highSignalScore = Math.min(setlist.high_signal_count * 2, 10)

    const raw =
      setlistScore    * 0.45 +
      highSignalScore * 0.25 +
      genreScore      * 0.30

    confidence_score = parseFloat(Math.min(raw, 8.5).toFixed(1))
  }

  // ── Explanation ───────────────────────────────────────────────────
  const reasons: string[] = []

  if (isTier1) {
    reasons.push('Confirmed jam band or Grateful Dead family act')
  }

  if (setlist.jam_songs.length > 0) {
    const top = setlist.jam_songs.slice(0, 3)
    const extra = setlist.jam_songs.length > 3 ? ` and ${setlist.jam_songs.length - 3} more` : ''
    reasons.push(
      `Played ${top.map((s) => titleCase(s)).join(', ')}${extra} across ${setlist.setlists_analyzed} recent shows`
    )
  }

  if (genres.matched_jam_genres.length > 0) {
    reasons.push(`Genre: ${genres.matched_jam_genres.slice(0, 2).join(', ')}`)
  }

  const signal_label =
    confidence_score >= 7.5 ? 'High-confidence jam signal' :
    confidence_score >= 4.0 ? 'Strong jam-adjacent signal' :
    confidence_score >= 2.5 ? 'Possible fit — limited but relevant signal' :
                              'Weak signal — excluded from results'

  const ai_explanation =
    reasons.length > 0
      ? `${signal_label} · ${reasons.join(' · ')}`
      : signal_label

  const genre_tags =
    genres.genres.length > 0
      ? genres.genres
      : [tm_genre, tm_subgenre].filter((g): g is string => !!g)

  return {
    confidence_score,
    ai_explanation,
    genre_tags,
    setlist_jam_songs: setlist.jam_songs,
    attribution_url: setlist.found ? setlist.attribution_url : null,
    // Run Setlist.fm if: confirmed Tier 1 act, OR genre signal (Last.fm or TM) is strong,
    // OR Last.fm has no record of them (local/unsigned acts — setlist is our only signal).
    should_run_setlist: isTier1 || genreScore >= 4 || !genres.found,
  }
}

function titleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}
