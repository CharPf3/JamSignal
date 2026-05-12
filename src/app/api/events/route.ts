import { NextRequest, NextResponse } from 'next/server'
import { geocodeLocation } from '@/lib/geocoding'
import { fetchJamEvents } from '@/lib/ticketmaster/client'
import { getSpotifyArtistData } from '@/lib/spotify/client'
import { getSetlistData } from '@/lib/setlistfm/client'
import { scoreBand } from '@/lib/scoring'
import type { EventResult } from '@/types/index'

export type PipelineStats = {
  raw_event_count: number
  unique_bands: number
  spotify_matched: number
  spotify_jam_genres: number
  setlist_analyzed: number
  setlist_gd_bands: number
  final_count: number
}

function getDateRange(days = 60): { startDate: string; endDate: string } {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + days)
  const fmt = (d: Date) => d.toISOString().split('T')[0] as string
  return { startDate: fmt(now), endDate: fmt(end) }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const location = params.get('location')
  const radius = parseInt(params.get('radius') ?? '50', 10)
  const days = parseInt(params.get('days') ?? '60', 10)

  if (!location || location.trim().length < 2) {
    return NextResponse.json({ error: 'Location is required' }, { status: 400 })
  }
  if (radius < 10 || radius > 300) {
    return NextResponse.json({ error: 'Radius must be between 10 and 300 miles' }, { status: 400 })
  }

  const geo = await geocodeLocation(location.trim())
  if (!geo) {
    return NextResponse.json({ error: 'Could not find that location' }, { status: 404 })
  }

  const { startDate, endDate } = getDateRange(Math.min(days, 90))

  // ── Stage 1: Fetch raw events ─────────────────────────────────────
  const rawEvents = await fetchJamEvents({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radius,
    startDate,
    endDate,
  })

  const stats: PipelineStats = {
    raw_event_count: rawEvents.length,
    unique_bands: 0,
    spotify_matched: 0,
    spotify_jam_genres: 0,
    setlist_analyzed: 0,
    setlist_gd_bands: 0,
    final_count: 0,
  }

  // ── Stage 2: Extract unique band names ────────────────────────────
  const uniqueBands = [...new Set(rawEvents.map((e) => e.band_name))]
  stats.unique_bands = uniqueBands.length

  // ── Stage 3 & 4: Enrich each unique band in parallel ─────────────
  const bandScores = new Map<string, Awaited<ReturnType<typeof scoreBand>>>()

  await Promise.all(
    uniqueBands.map(async (bandName) => {
      // Always run Spotify — fast, no ToS concern
      const spotify = await getSpotifyArtistData(bandName)
      if (spotify.found) stats.spotify_matched++
      if (spotify.jam_genre_score > 0) stats.spotify_jam_genres++

      // Run Setlist.fm selectively — Tier 1 bands or Spotify-validated
      const tempScore = scoreBand({ band_name: bandName, spotify, setlist: { mbid: '', gd_songs: [], gd_song_count: 0, high_signal_count: 0, setlists_analyzed: 0, attribution_url: '', found: false } })
      const runSetlist = tempScore.should_run_setlist

      let setlist = { mbid: '', gd_songs: [] as string[], gd_song_count: 0, high_signal_count: 0, setlists_analyzed: 0, attribution_url: 'https://www.setlist.fm', found: false }

      if (runSetlist) {
        stats.setlist_analyzed++
        setlist = await getSetlistData(bandName)
        if (setlist.gd_song_count > 0) stats.setlist_gd_bands++
      }

      const result = scoreBand({ band_name: bandName, spotify, setlist })
      bandScores.set(bandName, result)
    })
  )

  // ── Stage 5: Build EventResult list ──────────────────────────────
  const events: EventResult[] = rawEvents.map((event) => {
    const score = bandScores.get(event.band_name)
    return {
      ...event,
      confidence_score: score?.confidence_score ?? null,
      ai_explanation: score?.ai_explanation ?? null,
      genre_tags: score?.genre_tags ?? [],
      setlist_gd_songs: score?.setlist_gd_songs ?? [],
    }
  })

  // ── Stage 6: Sort by confidence then date ─────────────────────────
  events.sort((a, b) => {
    const scoreDiff = (b.confidence_score ?? 0) - (a.confidence_score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    if (a.date < b.date) return -1
    if (a.date > b.date) return 1
    return 0
  })

  stats.final_count = events.length

  // Log pipeline stats server-side for visibility
  console.log('\n── JamSignal Pipeline Stats ──────────────────────')
  console.log(`Location:           ${geo.display_name}`)
  console.log(`Raw TM events:      ${stats.raw_event_count}`)
  console.log(`Unique bands:       ${stats.unique_bands}`)
  console.log(`Spotify matched:    ${stats.spotify_matched}`)
  console.log(`w/ jam genres:      ${stats.spotify_jam_genres}`)
  console.log(`Setlist analyzed:   ${stats.setlist_analyzed}`)
  console.log(`w/ GD songs:        ${stats.setlist_gd_bands}`)
  console.log(`Final results:      ${stats.final_count}`)
  console.log('──────────────────────────────────────────────────\n')

  return NextResponse.json({ location: geo, radius, events, total: events.length, stats })
}
