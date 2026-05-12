import { isJamSong, isHighSignalJamSong, normalizeSetlistSong } from './jam-songs'

export type SetlistData = {
  mbid: string              // MusicBrainz ID — the unique artist identifier setlist.fm uses
  jam_songs: string[]       // jam canon songs detected across recent shows (deduplicated)
  jam_song_count: number    // total jam song appearances (counts repeats across shows)
  high_signal_count: number // appearances of especially strong signals (Reba, Dark Star, YEM, etc.)
  setlists_analyzed: number
  attribution_url: string   // required by setlist.fm ToS — must display this link
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
    let jamSongCount = 0
    let highSignalCount = 0
    const attributionUrl = recent[0]?.artist.url ?? 'https://www.setlist.fm'

    for (const setlist of recent) {
      for (const set of setlist.sets.set) {
        for (const song of set.song ?? []) {
          const normalized = normalizeSetlistSong(song.name)

          if (isJamSong(song.name)) {
            jamSongsFound.add(normalized)
            jamSongCount++
            if (isHighSignalJamSong(song.name)) highSignalCount++
          }

          // Also check if it's a cover of a jam canon song
          if (song.cover && isJamSong(song.cover.name)) {
            jamSongsFound.add(normalizeSetlistSong(song.cover.name))
            jamSongCount++
            if (isHighSignalJamSong(song.cover.name)) highSignalCount++
          }
        }
      }
    }

    return {
      mbid,
      jam_songs: Array.from(jamSongsFound),
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
