// Shared genre data contract used by Last.fm, caching, and scoring.
// Originally sourced from Spotify — now populated by Last.fm (Spotify removed
// genre data from dev-tier apps in November 2024).
export type ArtistGenreData = {
  genres: string[]
  jam_genre_score: number      // sum of matched tag weights, capped at 10
  matched_jam_genres: string[] // which tags matched
  found: boolean
}
