import { getSpotifyToken } from './auth'

// Spotify genres that signal jam/psychedelic relevance.
// Scored by how strongly they indicate a jam-adjacent act.
const JAM_GENRES: Record<string, number> = {
  // Direct hits — unambiguous
  'jam band':              10,
  'jam rock':              10,
  'jamgrass':              10,
  'psychedelic rock':       8,
  'improvisational':        9,
  'neo-psychedelic':        7,
  'acid rock':              7,

  // Strong indicators
  'americana':              5,
  'folk rock':              5,
  'southern rock':          5,
  'roots rock':             5,
  'country rock':           4,
  'bluegrass':              5,
  'progressive rock':       4,

  // Weaker — genre-adjacent, need other signals
  'funk':                   3,
  'blues rock':             3,
  'alternative country':    3,
  'indie folk':             2,
}

export type SpotifyArtistData = {
  spotify_id: string
  genres: string[]
  jam_genre_score: number      // sum of matched genre weights, capped at 10
  matched_jam_genres: string[] // which jam genres matched
  popularity: number           // 0–100
  found: boolean
}

type SpotifyArtist = {
  id: string
  name: string
  genres: string[]
  popularity: number
}

type SpotifySearchResponse = {
  artists: {
    items: SpotifyArtist[]
  }
}

function scoreGenres(genres: string[]): { score: number; matched: string[] } {
  let total = 0
  const matched: string[] = []

  for (const genre of genres) {
    const lower = genre.toLowerCase()
    for (const [jamGenre, weight] of Object.entries(JAM_GENRES)) {
      if (lower.includes(jamGenre)) {
        total += weight
        matched.push(genre)
        break
      }
    }
  }

  return { score: Math.min(total, 10), matched }
}

// Normalize band names for better Spotify matching.
// Removes common suffixes that differ between sources.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bband\b/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function getSpotifyArtistData(bandName: string): Promise<SpotifyArtistData> {
  const notFound: SpotifyArtistData = {
    spotify_id: '',
    genres: [],
    jam_genre_score: 0,
    matched_jam_genres: [],
    popularity: 0,
    found: false,
  }

  try {
    const token = await getSpotifyToken()

    const params = new URLSearchParams({
      q: bandName,
      type: 'artist',
      limit: '5',
    })

    const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) return notFound

    const data = (await res.json()) as SpotifySearchResponse
    const candidates = data.artists.items

    if (!candidates.length) return notFound

    // Pick the best match — prefer exact name match, fall back to first result
    const normalizedSearch = normalizeName(bandName)
    const best =
      candidates.find((a) => normalizeName(a.name) === normalizedSearch) ??
      candidates[0]

    if (!best) return notFound

    const { score, matched } = scoreGenres(best.genres)

    return {
      spotify_id: best.id,
      genres: best.genres,
      jam_genre_score: score,
      matched_jam_genres: matched,
      popularity: best.popularity,
      found: true,
    }
  } catch {
    return notFound
  }
}
