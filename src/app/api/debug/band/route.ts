import { NextRequest, NextResponse } from 'next/server'
import { getSpotifyArtistData } from '@/lib/spotify/client'
import { getSetlistData } from '@/lib/setlistfm/client'
import { getSpotifyToken } from '@/lib/spotify/auth'

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name') ?? 'Dark Star Orchestra'

  // Test Spotify token first
  let tokenOk = false
  let tokenError = ''
  try {
    await getSpotifyToken()
    tokenOk = true
  } catch (e) {
    tokenError = String(e)
  }

  const spotify = await getSpotifyArtistData(name)
  const setlist = await getSetlistData(name)

  return NextResponse.json({
    band: name,
    spotify_token_ok: tokenOk,
    spotify_token_error: tokenError || null,
    spotify,
    setlist,
    env_check: {
      has_spotify_id: !!process.env.SPOTIFY_CLIENT_ID,
      has_spotify_secret: !!process.env.SPOTIFY_CLIENT_SECRET,
      has_setlistfm_key: !!process.env.SETLISTFM_API_KEY,
    },
  })
}
