import { NextRequest, NextResponse } from 'next/server'
import { geocodeLocation } from '@/lib/geocoding'
import { fetchJamEvents } from '@/lib/ticketmaster/client'
import type { EventResult } from '@/types/index'

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

  const rawEvents = await fetchJamEvents({
    latitude: geo.latitude,
    longitude: geo.longitude,
    radius,
    startDate,
    endDate,
  })

  // Promote Event → EventResult, filling Phase 2 fields with empty defaults.
  // Scoring and AI explanation will populate these in Phase 2.
  const events: EventResult[] = rawEvents.map((event) => ({
    ...event,
    confidence_score: null,
    ai_explanation: null,
    genre_tags: [],
    setlist_gd_songs: [],
  }))

  return NextResponse.json({
    location: geo,
    radius,
    events,
    total: events.length,
  })
}
