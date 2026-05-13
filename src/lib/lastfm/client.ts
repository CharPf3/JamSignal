import type { ArtistGenreData } from '@/lib/spotify/client'

// Last.fm tag weights.
// "jam band" / "jam rock" from Last.fm means fans explicitly tagged them as jam — trust it fully.
// Genre-adjacent tags (blues, southern rock, americana) are supporting evidence only,
// weighted low so stacking them can't substitute for an actual jam tag.
const JAM_TAGS: Record<string, number> = {
  // Direct hits — a single tag here means jam band, full stop
  'jam band':           10,
  'jam rock':           10,
  'jamgrass':           10,
  'jambands':           10,
  'improvisational':     8,
  'newgrass':            8,
  'electronic jam':      7,
  'jam':                 6,
  'jam-funk':            7,
  'psychedelic rock':    7,
  'psychedelia':         6,
  'neo-psychedelic':     6,
  'acid rock':           6,
  

  // Adjacent — meaningful supporting signal, but stacking these shouldn't hit the ceiling
  'bluegrass':           3,
  'americana':           3,
  'new americana':       3,
  'folk rock':           3,
  'southern rock':       2,
  'roots rock':          2,
  'progressive rock':    2,
  'country rock':        2,
  'outlaw country':      2,

  // Weak — only useful in combination with stronger signals
  'funk':                1,
  'blues rock':          1,
  'blues':               1,
  'country blues':       1,
  'soul':                1,
  'indie folk':          1,
}

// Last.fm meta-tags that carry no genre signal
const SKIP_TAGS = new Set([
  'seen live', 'favourites', 'favorite', 'love', 'awesome', 'beautiful',
  'amazing', 'good', 'best', 'classic', 'under 2000 listeners',
])

function scoreLastFmTags(tags: string[]): { score: number; matched: string[] } {
  let total = 0
  const matched: string[] = []
  for (const tag of tags) {
    const lower = tag.toLowerCase()
    for (const [jamTag, weight] of Object.entries(JAM_TAGS)) {
      if (lower.includes(jamTag)) {
        total += weight
        matched.push(tag)
        break
      }
    }
  }
  return { score: Math.min(total, 10), matched }
}

export async function getLastFmData(artistName: string): Promise<ArtistGenreData> {
  const apiKey = process.env.LASTFM_API_KEY

  const notFound: ArtistGenreData = {
    genres: [],
    jam_genre_score: 0,
    matched_jam_genres: [],
    found: false,
  }

  if (!apiKey) {
    console.warn('[LastFm] LASTFM_API_KEY not set')
    return notFound
  }

  try {
    const params = new URLSearchParams({
      method: 'artist.gettoptags',
      artist: artistName,
      api_key: apiKey,
      format: 'json',
    })

    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn(`[LastFm] "${artistName}" → HTTP ${res.status}`)
      return notFound
    }

    const data = (await res.json()) as {
      toptags?: { tag?: Array<{ name: string; count: number }> }
      error?: number
      message?: string
    }

    if (data.error) {
      if (data.error !== 6) console.warn(`[LastFm] "${artistName}" → error ${data.error}: ${data.message}`)
      return notFound
    }

    const tags = (data.toptags?.tag ?? [])
      .slice(0, 15)
      .map((t) => t.name.toLowerCase())
      .filter((t) => !SKIP_TAGS.has(t))

    const { score, matched } = scoreLastFmTags(tags)

    if (tags.length > 0) {
      console.log(`[LastFm] "${artistName}" → ${tags.slice(0, 5).join(', ')} (jam score: ${score})`)
    }

    return {
      genres: tags,
      jam_genre_score: score,
      matched_jam_genres: matched,
      found: true,
    }
  } catch (err) {
    console.warn(`[LastFm] "${artistName}" → threw:`, err)
    return notFound
  }
}
