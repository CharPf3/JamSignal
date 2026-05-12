import { getSupabase } from './client'
import type { SpotifyArtistData } from '@/lib/spotify/client'
import type { SetlistData } from '@/lib/setlistfm/client'

export type CachedBand = {
  spotify: SpotifyArtistData
  setlist: SetlistData
}

type BandRow = {
  artist_name: string
  spotify_id: string | null
  spotify_genres: string[]
  spotify_jam_genre_score: number
  spotify_matched_genres: string[]
  spotify_popularity: number
  spotify_found: boolean
  setlist_mbid: string | null
  jam_songs: string[]
  gd_songs: string[]
  jam_song_count: number
  high_signal_count: number
  setlists_analyzed: number
  setlist_attribution_url: string | null
  setlist_found: boolean
}

export async function getCachedBand(artistName: string): Promise<CachedBand | null> {
  const db = getSupabase()
  if (!db) return null

  const { data, error } = await db
    .from('band_cache')
    .select('*')
    .eq('artist_name', artistName)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null

  const row = data as BandRow

  return {
    spotify: {
      spotify_id:         row.spotify_id ?? '',
      genres:             row.spotify_genres,
      jam_genre_score:    row.spotify_jam_genre_score,
      matched_jam_genres: row.spotify_matched_genres,
      popularity:         row.spotify_popularity,
      found:              row.spotify_found,
    },
    setlist: {
      mbid:              row.setlist_mbid ?? '',
      jam_songs:         row.jam_songs,
      gd_songs:          row.gd_songs,
      jam_song_count:    row.jam_song_count,
      high_signal_count: row.high_signal_count,
      setlists_analyzed: row.setlists_analyzed,
      attribution_url:   row.setlist_attribution_url ?? 'https://www.setlist.fm',
      found:             row.setlist_found,
    },
  }
}

export async function cacheBand(
  artistName: string,
  spotify: SpotifyArtistData,
  setlist: SetlistData
): Promise<void> {
  const db = getSupabase()
  if (!db) return

  const now = new Date()
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { error } = await db.from('band_cache').upsert(
    {
      artist_name:             artistName,
      spotify_id:              spotify.spotify_id || null,
      spotify_genres:          spotify.genres,
      spotify_jam_genre_score: spotify.jam_genre_score,
      spotify_matched_genres:  spotify.matched_jam_genres,
      spotify_popularity:      spotify.popularity,
      spotify_found:           spotify.found,
      setlist_mbid:            setlist.mbid || null,
      jam_songs:               setlist.jam_songs,
      gd_songs:                setlist.gd_songs,
      jam_song_count:          setlist.jam_song_count,
      high_signal_count:       setlist.high_signal_count,
      setlists_analyzed:       setlist.setlists_analyzed,
      setlist_attribution_url: setlist.attribution_url || null,
      setlist_found:           setlist.found,
      cached_at:               now.toISOString(),
      expires_at:              expires.toISOString(),
    },
    { onConflict: 'artist_name' }
  )

  if (error) console.warn(`[Cache] Failed to cache "${artistName}":`, error.message)
}
