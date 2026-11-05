/**
 * Typed, single-point access to environment configuration.
 *
 * Every integration degrades rather than crashes when its key is absent, so
 * missing configuration must be legible: `missingKeys()` reports what is not
 * set, and the pipeline surfaces that instead of silently returning nothing.
 */

export type ServiceKey =
  | 'TICKETMASTER_API_KEY'
  | 'LASTFM_API_KEY'
  | 'SETLISTFM_API_KEY'
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'SUPABASE_SERVICE_ROLE_KEY'

const read = (key: ServiceKey): string | null => {
  const value = process.env[key]
  return value && value.trim().length > 0 ? value.trim() : null
}

export const env = {
  ticketmasterKey: () => read('TICKETMASTER_API_KEY'),
  lastfmKey: () => read('LASTFM_API_KEY'),
  setlistfmKey: () => read('SETLISTFM_API_KEY'),
  supabaseUrl: () => read('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: () => read('SUPABASE_SERVICE_ROLE_KEY'),
}

/** Contact string required by the MusicBrainz and Nominatim usage policies. */
export const USER_AGENT = 'JamSignal/1.0 (+https://jam-signal.vercel.app)'

/** Which services cannot run. Shown in the pipeline's diagnostics. */
export function missingKeys(): ServiceKey[] {
  const required: ServiceKey[] = [
    'TICKETMASTER_API_KEY',
    'LASTFM_API_KEY',
    'SETLISTFM_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  return required.filter((key) => read(key) === null)
}
