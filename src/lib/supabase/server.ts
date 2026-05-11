import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Service-role client — server-side only, never sent to the browser.
// Use this in API routes and server actions.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  })
}
