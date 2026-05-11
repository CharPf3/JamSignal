'use client'

import { useState } from 'react'
import { SearchForm } from '@/components/search/SearchForm'
import { EventList } from '@/components/events/EventList'
import type { EventResult, GeocodedLocation } from '@/types'

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; events: EventResult[]; location: GeocodedLocation; radius: number; query: string }

export default function HomePage() {
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })

  async function handleSearch(location: string, radius: number) {
    setSearch({ status: 'loading' })

    try {
      const params = new URLSearchParams({
        location,
        radius: String(radius),
      })
      const res = await fetch(`/api/events?${params}`)
      const data: unknown = await res.json()

      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? 'Something went wrong'
        setSearch({ status: 'error', message: msg })
        return
      }

      const payload = data as {
        events: EventResult[]
        location: GeocodedLocation
        radius: number
      }

      setSearch({
        status: 'done',
        events: payload.events,
        location: payload.location,
        radius: payload.radius,
        query: location,
      })
    } catch {
      setSearch({ status: 'error', message: 'Network error — please try again.' })
    }
  }

  return (
    <main className="flex flex-col flex-1">
      {/* Hero / search header */}
      <header className="bg-indigo-900 text-white px-4 py-14 text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">JamSignal</h1>
          <p className="text-indigo-200 text-lg max-w-lg mx-auto leading-relaxed">
            Find Grateful Dead tribute bands, jam bands, and Dead nights near you.
          </p>
        </div>

        <div className="max-w-2xl mx-auto">
          <SearchForm
            onSearch={handleSearch}
            loading={search.status === 'loading'}
          />
        </div>
      </header>

      {/* Results */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-10">
        {search.status === 'idle' && (
          <div className="text-center text-[var(--muted)] space-y-1 pt-8">
            <p className="text-base font-medium text-[var(--foreground)]">
              Enter a location to find shows near you.
            </p>
            <p className="text-sm">
              We search across Ticketmaster and more to surface setlist-vetted jam band events.
            </p>
          </div>
        )}

        {search.status === 'error' && (
          <div className="text-center py-10">
            <p className="text-red-600 font-medium">{search.message}</p>
          </div>
        )}

        {search.status === 'done' && (
          <EventList
            events={search.events}
            location={search.location.display_name.split(',').slice(0, 2).join(',')}
            radius={search.radius}
          />
        )}
      </div>
    </main>
  )
}
