// Module-level token cache — survives across requests in the same
// server instance. Spotify Client Credentials tokens last 3600s.
let cached: { token: string; expiresAt: number } | null = null

export async function getSpotifyToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing Spotify credentials in environment')
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
    throw new Error(`Spotify auth failed: ${res.status}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }

  // Expire 60s early to avoid edge-case expiry mid-request
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }

  return cached.token
}
