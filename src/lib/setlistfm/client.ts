import { isGdSong, isHighSignalGdSong, normalizeSetlistSong } from './gd-songs'

export type SetlistData = {
  mbid: string            // MusicBrainz ID — the unique artist identifier setlist.fm uses
  gd_songs: string[]      // GD songs detected across recent shows (deduplicated)
  gd_song_count: number   // total GD song appearances (not unique — counts repeats)
  high_signal_count: number // appearances of especially strong GD signals
  setlists_analyzed: number
  attribution_url: string  // required by setlist.fm ToS — must display this link
  found: boolean
}

// Setlist.fm API types
type SetlistFmArtist = {
  mbid: string
  name: string
  url: string
}

type SetlistFmSong = {
  name: string
  cover?: { name: string }
}

type SetlistFmSet = {
  song?: SetlistFmSong[]
}

type SetlistFmSetlist = {
  id: string
  artist: SetlistFmArtist
  sets: { set: SetlistFmSet[] }
  url: string
}

type SetlistFmSetlistsResponse = {
  setlist?: SetlistFmSetlist[]
  total?: number
}

type SetlistFmSearchResponse = {
  artist?: SetlistFmArtist[]
}

// How many recent shows to analyze. More = more accurate, more API calls.
const SETLISTS_TO_ANALYZE = 15

async function searchArtistMbid(bandName: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({ artistName: bandName, p: '1' })

  const res = await fetch(`https://api.setlist.fm/rest/1.0/search/artists?${params}`, {
    headers: {
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
  })

  if (!res.ok) return null

  const data = (await res.json()) as SetlistFmSearchResponse
  const artists = data.artist ?? []

  // Best match: exact name (case-insensitive), fall back to first result
  const lower = bandName.toLowerCase()
  const match =
    artists.find((a) => a.name.toLowerCase() === lower) ?? artists[0]

  return match?.mbid ?? null
}

async function fetchSetlists(
  mbid: string,
  apiKey: string
): Promise<SetlistFmSetlist[]> {
  const params = new URLSearchParams({ p: '1' })

  const res = await fetch(
    `https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?${params}`,
    {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    }
  )

  if (!res.ok) return []

  const data = (await res.json()) as SetlistFmSetlistsResponse
  return data.setlist ?? []
}

export async function getSetlistData(bandName: string): Promise<SetlistData> {
  const apiKey = process.env.SETLISTFM_API_KEY

  const notFound: SetlistData = {
    mbid: '',
    gd_songs: [],
    gd_song_count: 0,
    high_signal_count: 0,
    setlists_analyzed: 0,
    attribution_url: 'https://www.setlist.fm',
    found: false,
  }

  if (!apiKey) {
    console.warn('SETLISTFM_API_KEY not set')
    return notFound
  }

  try {
    const mbid = await searchArtistMbid(bandName, apiKey)
    if (!mbid) return notFound

    const setlists = await fetchSetlists(mbid, apiKey)
    const recent = setlists.slice(0, SETLISTS_TO_ANALYZE)

    if (!recent.length) return notFound

    const gdSongsFound = new Set<string>()
    let gdSongCount = 0
    let highSignalCount = 0
    const attributionUrl = recent[0]?.artist.url ?? 'https://www.setlist.fm'

    for (const setlist of recent) {
      for (const set of setlist.sets.set) {
        for (const song of set.song ?? []) {
          const normalized = normalizeSetlistSong(song.name)

          if (isGdSong(song.name)) {
            gdSongsFound.add(normalized)
            gdSongCount++

            if (isHighSignalGdSong(song.name)) {
              highSignalCount++
            }
          }

          // Also check if it's a cover of a GD song
          if (song.cover && isGdSong(song.cover.name)) {
            gdSongsFound.add(normalizeSetlistSong(song.cover.name))
            gdSongCount++
            if (isHighSignalGdSong(song.cover.name)) highSignalCount++
          }
        }
      }
    }

    return {
      mbid,
      gd_songs: Array.from(gdSongsFound),
      gd_song_count: gdSongCount,
      high_signal_count: highSignalCount,
      setlists_analyzed: recent.length,
      attribution_url: attributionUrl,
      found: true,
    }
  } catch {
    return notFound
  }
}
