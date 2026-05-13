import { NextRequest, NextResponse } from 'next/server'
import { geocodeLocation } from '@/lib/geocoding'
import { fetchJamEvents } from '@/lib/ticketmaster/client'
import { getLastFmData } from '@/lib/lastfm/client'
import { getSetlistData } from '@/lib/setlistfm/client'
import { scoreBand } from '@/lib/scoring'
import { getCachedBand, cacheBand } from '@/lib/supabase/bands'
import type { ArtistGenreData } from '@/lib/spotify/client'
import type { SetlistData } from '@/lib/setlistfm/client'

type BandDebug = {
  band_name: string
  artist_name: string
  tm_genre: string | null
  tm_subgenre: string | null
  cached: boolean
  lastfm: ArtistGenreData
  setlist: Pick<SetlistData, 'found' | 'jam_songs' | 'jam_song_count' | 'high_signal_count' | 'setlists_analyzed'>
  score: number
  passed_filter: boolean
  explanation: string
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const location = params.get('location') ?? 'Madison, WI'
  const radius = parseInt(params.get('radius') ?? '50', 10)

  const geo = await geocodeLocation(location.trim())
  if (!geo) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 60)
  const fmt = (d: Date) => d.toISOString().split('T')[0] as string

  const rawEvents = await fetchJamEvents({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radius,
    startDate: fmt(now),
    endDate: fmt(end),
  })

  const uniqueBandMap = new Map<string, string>()
  const bandTmGenre = new Map<string, { tm_genre: string | null; tm_subgenre: string | null }>()
  for (const event of rawEvents) {
    if (!uniqueBandMap.has(event.band_name)) {
      uniqueBandMap.set(event.band_name, event.artist_name)
      bandTmGenre.set(event.band_name, { tm_genre: event.tm_genre, tm_subgenre: event.tm_subgenre })
    }
  }

  const emptySetlist: SetlistData = {
    mbid: '', jam_songs: [], gd_songs: [], jam_song_count: 0,
    high_signal_count: 0, setlists_analyzed: 0,
    attribution_url: 'https://www.setlist.fm', found: false,
  }

  const MAX_SETLIST_CALLS = 15
  let setlistCalls = 0
  const results: BandDebug[] = []

  for (const [bandName, artistName] of uniqueBandMap.entries()) {
    const tmData = bandTmGenre.get(bandName) ?? { tm_genre: null, tm_subgenre: null }
    let genres: ArtistGenreData
    let setlist: SetlistData = { ...emptySetlist }
    let wasCached = false

    const cached = await getCachedBand(artistName)
    if (cached) {
      genres = cached.genres
      setlist = cached.setlist
      wasCached = true
    } else {
      genres = await getLastFmData(artistName)
      await new Promise((r) => setTimeout(r, 220))

      const tempScore = scoreBand({ band_name: bandName, artist_name: artistName, genres, setlist: emptySetlist, ...tmData })
      const isTier1Band = tempScore.confidence_score >= 7.0

      if (tempScore.should_run_setlist && (isTier1Band || setlistCalls < MAX_SETLIST_CALLS)) {
        if (!isTier1Band) setlistCalls++
        setlist = await getSetlistData(artistName)
        await new Promise((r) => setTimeout(r, 550))
      }

      if (genres.found || setlist.found) {
        await cacheBand(artistName, genres, setlist)
      }
    }

    const score = scoreBand({ band_name: bandName, artist_name: artistName, genres, setlist, ...tmData })

    results.push({
      band_name: bandName,
      artist_name: artistName,
      tm_genre: tmData.tm_genre,
      tm_subgenre: tmData.tm_subgenre,
      cached: wasCached,
      lastfm: genres,
      setlist: {
        found: setlist.found,
        jam_songs: setlist.jam_songs,
        jam_song_count: setlist.jam_song_count,
        high_signal_count: setlist.high_signal_count,
        setlists_analyzed: setlist.setlists_analyzed,
      },
      score: score.confidence_score,
      passed_filter: score.confidence_score >= 2.5,
      explanation: score.ai_explanation,
    })
  }

  results.sort((a, b) => b.score - a.score)

  const passed = results.filter((r) => r.passed_filter)
  const filtered = results.filter((r) => !r.passed_filter)

  return NextResponse.json({
    location: geo.display_name,
    radius,
    raw_event_count: rawEvents.length,
    unique_bands: uniqueBandMap.size,
    passed_count: passed.length,
    filtered_count: filtered.length,
    passed,
    filtered,
  })
}
