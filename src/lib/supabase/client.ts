import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

// Browser client — safe for use in client components.
// Only has access to public data (no service role).
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  )
}
