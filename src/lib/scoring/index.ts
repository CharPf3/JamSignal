import { TIER_1_KEYWORDS } from '@/lib/ticketmaster/keywords'
import type { SpotifyArtistData } from '@/lib/spotify/client'
import type { SetlistData } from '@/lib/setlistfm/client'

export type ScoringInput = {
  band_name: string
  spotify: SpotifyArtistData
  setlist: SetlistData
}

export type ScoringResult = {
  confidence_score: number       // 0.0–10.0
  ai_explanation: string         // human-readable reason
  genre_tags: string[]
  setlist_gd_songs: string[]
  attribution_url: string | null // setlist.fm attribution (ToS requirement)
  should_run_setlist: boolean    // whether Setlist.fm analysis was warranted
}

// Whether a band name matches a Tier 1 keyword.
// Checks both exact and substring match to catch things like
// "Grateful Dead Tribute — The Complete Show".
function matchesTier1(bandName: string): boolean {
  const lower = bandName.toLowerCase()
  return TIER_1_KEYWORDS.some(
    (kw) => lower === kw || lower.includes(kw)
  )
}

// Weights for each scoring layer.
// Total possible raw score: 10 + 10 + 10 + 10 = 40 → normalized to 10.
const WEIGHTS = {
  setlist:   0.40,  // GD songs in recent sets — direct evidence
  tier1:     0.25,  // known jam act by name — we chose these
  spotify:   0.20,  // jam genre tags from Spotify
  highSignal: 0.15, // bonus for especially strong GD songs (Scarlet, Dark Star, etc.)
} as const

export function scoreBand(input: ScoringInput): ScoringResult {
  const { band_name, spotify, setlist } = input
  const isTier1 = matchesTier1(band_name)

  // ── Setlist score (0–10) ──────────────────────────────────────────
  // Scale: 1 song = 1pt, 5 songs = 5pt, 10+ = 10pt (capped)
  const setlistRaw = Math.min(setlist.gd_song_count, 10)
  const setlistScore = (setlistRaw / 10) * 10

  // ── High-signal bonus (0–10) ──────────────────────────────────────
  // Extra weight for songs like Dark Star, Scarlet, Terrapin
  const highSignalScore = Math.min(setlist.high_signal_count * 2, 10)

  // ── Tier 1 score (0 or 10) ────────────────────────────────────────
  const tier1Score = isTier1 ? 10 : 0

  // ── Spotify score (0–10) ──────────────────────────────────────────
  const spotifyScore = spotify.jam_genre_score

  // ── Weighted total → 0.0–10.0 ────────────────────────────────────
  const raw =
    setlistScore   * WEIGHTS.setlist +
    tier1Score     * WEIGHTS.tier1 +
    spotifyScore   * WEIGHTS.spotify +
    highSignalScore * WEIGHTS.highSignal

  const confidence_score = parseFloat(Math.min(raw, 10).toFixed(1))

  // ── Explanation ───────────────────────────────────────────────────
  const reasons: string[] = []

  if (setlist.gd_songs.length > 0) {
    const top = setlist.gd_songs.slice(0, 3)
    const extra = setlist.gd_songs.length > 3 ? ` and ${setlist.gd_songs.length - 3} more` : ''
    reasons.push(
      `Played ${top.map((s) => titleCase(s)).join(', ')}${extra} across ${setlist.setlists_analyzed} recent shows`
    )
  }

  if (isTier1) {
    reasons.push('Confirmed jam band or Grateful Dead family act')
  }

  if (spotify.matched_jam_genres.length > 0) {
    reasons.push(`Genre: ${spotify.matched_jam_genres.slice(0, 2).join(', ')}`)
  }

  const ai_explanation =
    reasons.length > 0
      ? reasons.join(' · ')
      : confidence_score >= 5
        ? 'Matches jam band search criteria'
        : 'Loosely jam-adjacent — limited data available'

  return {
    confidence_score,
    ai_explanation,
    genre_tags: spotify.genres,
    setlist_gd_songs: setlist.gd_songs,
    attribution_url: setlist.found ? setlist.attribution_url : null,
    should_run_setlist: isTier1 || spotify.jam_genre_score >= 4,
  }
}

function titleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}
