import { getSupabase } from './client'
import type { ArtistGenreData } from '@/lib/spotify/client'
import type { SetlistData } from '@/lib/setlistfm/client'

export type CachedBand = {
  genres: ArtistGenreData
  setlist: SetlistData
}

// Matches the band_cache table columns (see supabase/schema.sql)
type BandRow = {
  artist_name: string
  genre_tags: string[]
  jam_genre_score: number
  matched_genre_tags: string[]
  genre_found: boolean
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
    genres: {
      genres:             row.genre_tags,
      jam_genre_score:    row.jam_genre_score,
      matched_jam_genres: row.matched_genre_tags,
      found:              row.genre_found,
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
  genres: ArtistGenreData,
  setlist: SetlistData
): Promise<void> {
  const db = getSupabase()
  if (!db) return

  const now = new Date()
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { error } = await db.from('band_cache').upsert(
    {
      artist_name:         artistName,
      genre_tags:          genres.genres,
      jam_genre_score:     genres.jam_genre_score,
      matched_genre_tags:  genres.matched_jam_genres,
      genre_found:         genres.found,
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
