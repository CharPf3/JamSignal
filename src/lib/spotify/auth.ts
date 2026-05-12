let cached: { token: string; expiresAt: number } | null = null
let inFlight: Promise<string> | null = null

export async function getSpotifyToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token
  if (!inFlight) {
    inFlight = fetchToken().finally(() => { inFlight = null })
  }
  return inFlight!
}

async function fetchToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('[Spotify] Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment')
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    throw new Error(`[Spotify] Auth failed: HTTP ${res.status}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }

  console.log(`[Spotify] Token obtained — expires in ${data.expires_in}s`)
  return cached.token
}
