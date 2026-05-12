import { isJamSong, isHighSignalJamSong, normalizeSetlistSong } from './jam-songs'
import { isGdSong } from './gd-songs'

export type SetlistData = {
  mbid: string
  jam_songs: string[]       // all jam canon songs (GD + Phish + Widespread + Allman + Gov't Mule)
  gd_songs: string[]        // Grateful Dead subset — stored separately for descriptions
  jam_song_count: number    // total appearances across shows (counts repeats)
  high_signal_count: number
  setlists_analyzed: number
  attribution_url: string   // required by setlist.fm ToS
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
    jam_songs: [],
    gd_songs: [],
    jam_song_count: 0,
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

    const jamSongsFound = new Set<string>()
    const gdSongsFound = new Set<string>()
    let jamSongCount = 0
    let highSignalCount = 0
    const attributionUrl = recent[0]?.artist.url ?? 'https://www.setlist.fm'

    function trackSong(name: string) {
      const normalized = normalizeSetlistSong(name)
      if (isJamSong(name)) {
        jamSongsFound.add(normalized)
        jamSongCount++
        if (isHighSignalJamSong(name)) highSignalCount++
        if (isGdSong(name)) gdSongsFound.add(normalized)
      }
    }

    for (const setlist of recent) {
      for (const set of setlist.sets.set) {
        for (const song of set.song ?? []) {
          trackSong(song.name)
          if (song.cover) trackSong(song.cover.name)
        }
      }
    }

    return {
      mbid,
      jam_songs: Array.from(jamSongsFound),
      gd_songs: Array.from(gdSongsFound),
      jam_song_count: jamSongCount,
      high_signal_count: highSignalCount,
      setlists_analyzed: recent.length,
      attribution_url: attributionUrl,
      found: true,
    }
  } catch {
    return notFound
  }
}
