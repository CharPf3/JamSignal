import { NextRequest, NextResponse } from 'next/server'
import { geocodeLocation } from '@/lib/geocoding'
import { fetchJamEvents } from '@/lib/ticketmaster/client'
import { getLastFmData } from '@/lib/lastfm/client'
import { getSetlistData } from '@/lib/setlistfm/client'
import { scoreBand } from '@/lib/scoring'
import { getCachedBand, cacheBand } from '@/lib/supabase/bands'
import type { EventResult } from '@/types/index'

export type PipelineStats = {
  raw_event_count: number
  unique_bands: number
  cache_hits: number
  lastfm_matched: number
  lastfm_jam_genres: number
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
    cache_hits: 0,
    lastfm_matched: 0,
    lastfm_jam_genres: 0,
    setlist_analyzed: 0,
    setlist_gd_bands: 0,
    final_count: 0,
  }

  // ── Stage 2: Extract unique bands (band_name → artist_name) ──────
  // band_name = event title for display; artist_name = canonical name for API lookups
  const uniqueBandMap = new Map<string, string>()
  const bandTmGenre = new Map<string, { tm_genre: string | null; tm_subgenre: string | null }>()
  for (const event of rawEvents) {
    if (!uniqueBandMap.has(event.band_name)) {
      uniqueBandMap.set(event.band_name, event.artist_name)
      bandTmGenre.set(event.band_name, { tm_genre: event.tm_genre, tm_subgenre: event.tm_subgenre })
    }
  }
  stats.unique_bands = uniqueBandMap.size

  const emptySetlist = {
    mbid: '',
    jam_songs: [] as string[],
    gd_songs: [] as string[],
    jam_song_count: 0,
    high_signal_count: 0,
    setlists_analyzed: 0,
    attribution_url: 'https://www.setlist.fm',
    found: false,
  }

  // ── Stages 3+4: Enrichment — cache-first, then Last.fm + Setlist.fm ──
  // Cache hit  → skip all API calls, score from stored data instantly.
  // Cache miss → call Last.fm, then Setlist.fm if warranted, then write to cache.
  const MAX_SETLIST_CALLS = 15
  let setlistCalls = 0

  const bandScores = new Map<string, Awaited<ReturnType<typeof scoreBand>>>()
  const genreResults = new Map<string, Awaited<ReturnType<typeof getLastFmData>>>()

  for (const [bandName, artistName] of uniqueBandMap.entries()) {
    // ── Cache check ───────────────────────────────────────────────
    const cached = await getCachedBand(artistName)

    if (cached) {
      stats.cache_hits++
      if (cached.genres.found) stats.lastfm_matched++
      if (cached.genres.jam_genre_score > 0) stats.lastfm_jam_genres++
      if (cached.setlist.found) {
        stats.setlist_analyzed++
        if (cached.setlist.jam_song_count > 0) stats.setlist_gd_bands++
      }
      genreResults.set(bandName, cached.genres)
      const tmData = bandTmGenre.get(bandName) ?? { tm_genre: null, tm_subgenre: null }
      bandScores.set(bandName, scoreBand({ band_name: bandName, artist_name: artistName, genres: cached.genres, setlist: cached.setlist, ...tmData }))
      continue
    }

    const tmData = bandTmGenre.get(bandName) ?? { tm_genre: null, tm_subgenre: null }

    // ── Last.fm (genre tags) ──────────────────────────────────────
    const genres = await getLastFmData(artistName)
    if (genres.found) stats.lastfm_matched++
    if (genres.jam_genre_score > 0) stats.lastfm_jam_genres++
    genreResults.set(bandName, genres)
    await new Promise((r) => setTimeout(r, 220))

    // ── Setlist.fm (selective) ────────────────────────────────────
    const tempScore = scoreBand({ band_name: bandName, artist_name: artistName, genres, setlist: emptySetlist, ...tmData })
    let setlist = { ...emptySetlist }

    const isTier1Band = tempScore.confidence_score >= 7.0
    if (tempScore.should_run_setlist && (isTier1Band || setlistCalls < MAX_SETLIST_CALLS)) {
      if (!isTier1Band) setlistCalls++
      stats.setlist_analyzed++
      setlist = await getSetlistData(artistName)
      if (setlist.jam_song_count > 0) stats.setlist_gd_bands++
      await new Promise((r) => setTimeout(r, 550))
    }

    // ── Cache write (only when we got real data) ──────────────────
    if (genres.found || setlist.found) {
      await cacheBand(artistName, genres, setlist)
    }

    bandScores.set(bandName, scoreBand({ band_name: bandName, artist_name: artistName, genres, setlist, ...tmData }))
  }

  // ── Stage 5: Build EventResult list ──────────────────────────────
  const events: EventResult[] = rawEvents.map((event) => {
    const score = bandScores.get(event.band_name)
    return {
      ...event,
      confidence_score: score?.confidence_score ?? null,
      ai_explanation: score?.ai_explanation ?? null,
      genre_tags: score?.genre_tags ?? [],
      setlist_jam_songs: score?.setlist_jam_songs ?? [],
    }
  })

  // ── Stage 6: Filter true noise, sort by confidence then date ─────
  // 2.5 floor: genre adjacency alone (no jam tag, no setlist evidence) scores ~0.9–2.1
  // and should not surface. Anything passing 2.5 has at least one real signal.
  const filtered = events.filter((e) => (e.confidence_score ?? 0) >= 2.5)

  filtered.sort((a, b) => {
    const scoreDiff = (b.confidence_score ?? 0) - (a.confidence_score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    if (a.date < b.date) return -1
    if (a.date > b.date) return 1
    return 0
  })

  stats.final_count = filtered.length

  console.log('\n── JamSignal Pipeline Stats ──────────────────────')
  console.log(`Location:           ${geo.display_name}`)
  console.log(`Raw TM events:      ${stats.raw_event_count}`)
  console.log(`Unique bands:       ${stats.unique_bands}`)
  console.log(`Cache hits:         ${stats.cache_hits}`)
  console.log(`Last.fm matched:    ${stats.lastfm_matched}`)
  console.log(`w/ jam genres:      ${stats.lastfm_jam_genres}`)
  console.log(`Setlist analyzed:   ${stats.setlist_analyzed}`)
  console.log(`w/ jam songs:       ${stats.setlist_gd_bands}`)
  console.log(`Final results:      ${stats.final_count}`)
  console.log('── Band scores ───────────────────────────────────')
  for (const [bandName, score] of bandScores.entries()) {
    const genreData = genreResults.get(bandName)
    const marker = score.confidence_score > 0 ? '✓' : '✗'
    console.log(
      `  ${marker} ${bandName.padEnd(40)} score=${score.confidence_score.toFixed(1)}` +
      ` lastfm=${genreData?.found ? `✓ (${score.genre_tags.slice(0,2).join(',')})` : '✗'}` +
      ` jamsongs=${score.setlist_jam_songs.length}`
    )
  }
  console.log('──────────────────────────────────────────────────\n')

  return NextResponse.json({ location: geo, radius, events: filtered, total: filtered.length, stats })
}
