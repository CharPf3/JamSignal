import { getSpotifyToken } from './auth'

// Spotify genres that signal jam/psychedelic relevance.
// Scored by how strongly they indicate a jam-adjacent act.
const JAM_GENRES: Record<string, number> = {
  // Direct hits — unambiguous
  'jam band':              10,
  'jam rock':              10,
  'jamgrass':              10,
  'improvisational':        9,
  'psychedelic rock':       8,
  'psychedelia':            7,
  'neo-psychedelic':        7,
  'acid rock':              7,
  'newgrass':               8,  // String Cheese, Yonder Mountain, Billy Strings
  'jam':                    7,  // Spotify sometimes uses bare "jam"

  // Strong indicators
  'americana':              5,
  'new americana':          5,
  'folk rock':              5,
  'southern rock':          5,
  'roots rock':             5,
  'bluegrass':              5,
  'progressive rock':       4,
  'country rock':           4,
  'outlaw country':         4,  // Willie Nelson tradition, Waylon — crossover with jam

  // Weaker — genre-adjacent, need other signals
  'funk':                   3,
  'blues rock':             3,
  'blues':                  3,
  'country blues':          3,
  'alternative country':    3,
  'soul':                   2,  // Tedeschi Trucks, some jam acts get this tag
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

// Step 1 — always applied: strip the tour/show subtitle.
// "Marcus King Band: Darling Blue PT2 Tour" → "Marcus King Band"
// "Tyler Childers - Snipe Hunt"             → "Tyler Childers"
// "Dead & Company"                          → "Dead & Company" (unchanged — no subtitle)
function stripTourSuffix(name: string): string {
  const stripped = (name.split(/\s*:\s*|\s+[-–—]\s+/)[0] ?? name).trim()
  return stripped.length >= 3 ? stripped : name
}

// Step 2 — fallback only: when a cleaned name still finds nothing on Spotify,
// split a multi-artist billing and try the headliner alone.
// "Molly Tuttle & Maggie Rose" → "Molly Tuttle"
// "Dead & Company" never reaches this because step 1 finds them directly.
function extractHeadliner(name: string): string {
  const primary = (name.split(/\s*[&+]\s*|\s+(?:and|with|feat\.?|ft\.?|x|vs\.?|presents?)\s+/i)[0] ?? name).trim()
  return primary.length >= 3 ? primary : name
}

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

    async function searchSpotify(query: string): Promise<SpotifyArtist[]> {
      // Spotify's search API throttles by returning total > 0 but items: [] instead of HTTP 429.
      // Retry once with a delay when we see that pattern.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1200))

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 4000)

        let text = ''
        try {
          const res = await fetch(
            `https://api.spotify.com/v1/search?${new URLSearchParams({ q: query, type: 'artist', limit: '5', market: 'US' })}`,
            { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal }
          )
          clearTimeout(timeout)

          text = await res.text()

          if (!res.ok) {
            console.warn(`[Spotify] "${query}" → HTTP ${res.status}`)
            return []
          }

          let data: unknown
          try {
            data = JSON.parse(text)
          } catch {
            console.warn(`[Spotify] "${query}" → invalid JSON`)
            return []
          }

          const body = data as Partial<SpotifySearchResponse> & { error?: unknown }
          if (body.error) {
            console.warn(`[Spotify] "${query}" → error in body:`, body.error)
            return []
          }

          const items = body.artists?.items ?? []
          const total = (body.artists as { total?: number } | undefined)?.total ?? 0

          if (items.length === 0 && total > 0) {
            // Throttled — got count but no items. Retry if we have attempts left.
            console.warn(`[Spotify] "${query}" → throttled (total=${total}, attempt=${attempt + 1})`)
            continue
          }

          if (items.length > 0) {
            console.log(`[Spotify] "${query}" → ${items.length} results (top: "${items[0]?.name ?? ''}")`)
          }
          return items

        } catch (err) {
          clearTimeout(timeout)
          if (err instanceof Error && err.name === 'AbortError') {
            console.warn(`[Spotify] "${query}" → timed out`)
          } else {
            console.warn(`[Spotify] "${query}" → threw:`, err)
          }
          return []
        }
      }

      console.warn(`[Spotify] "${query}" → throttled on both attempts, giving up`)
      return []
    }

    // Always strip tour suffix first — "Marcus King Band: Tour" → "Marcus King Band"
    const cleanName = stripTourSuffix(bandName)

    // Search with the cleaned name. "Dead & Company" resolves here.
    let candidates = await searchSpotify(cleanName)

    // If still nothing, try splitting a multi-artist billing — "Molly Tuttle & Maggie Rose" → "Molly Tuttle"
    const headliner = extractHeadliner(cleanName)
    if (!candidates.length && headliner !== cleanName) {
      candidates = await searchSpotify(headliner)
    }

    if (!candidates.length) return notFound

    const normalizedClean = normalizeName(cleanName)
    const normalizedHeadliner = normalizeName(headliner)
    const best =
      candidates.find((a) => normalizeName(a.name) === normalizedClean) ??
      candidates.find((a) => normalizeName(a.name) === normalizedHeadliner) ??
      candidates[0]

    if (!best) return notFound

    const { score, matched } = scoreGenres(best.genres ?? [])

    return {
      spotify_id: best.id,
      genres: best.genres ?? [],
      jam_genre_score: score,
      matched_jam_genres: matched,
      popularity: best.popularity,
      found: true,
    }
  } catch (err) {
    console.warn(`[Spotify] getSpotifyArtistData("${bandName}") threw:`, err)
    return notFound
  }
}
