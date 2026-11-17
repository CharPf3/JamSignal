import { Suspense } from 'react'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchResults } from '@/components/results/SearchResults'
import { LoadingStage } from '@/components/results/LoadingStage'
import { EmptyState } from '@/components/results/EmptyState'

/**
 * Search state lives in the URL and the search runs on the server.
 *
 * Previously state was local React state and the browser fetched
 * `/api/events`, which meant a search could not be shared, bookmarked or
 * reloaded, the back button did nothing, and the first paint carried no
 * results. Reading `searchParams` here makes every search a real address:
 * `/?location=Madison%2C+WI&radius=50&days=60`.
 *
 * The Suspense boundary is keyed on the query, so changing it streams a fresh
 * skeleton rather than showing stale results under a spinner.
 */

export const metadata = { title: 'JamSignal — jam band shows near you' }

const DEFAULTS = { radius: 50, days: 60 } as const

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

type Props = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams
  const location = first(params.location)?.trim() ?? ''
  const radius = Number(first(params.radius)) || DEFAULTS.radius
  const days = Number(first(params.days)) || DEFAULTS.days

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center">
        <div className="mx-auto max-w-2xl space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
            JamSignal
          </h1>
          <p className="text-sm leading-relaxed text-[var(--ink-secondary)] sm:text-base">
            Jam bands, Dead tributes and improvisational acts playing near you —
            scored on evidence, with the reasoning shown.
          </p>
        </div>
      </header>

      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--plane)]/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <SearchBar location={location} radius={radius} days={days} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {location.length < 2 ? (
          <EmptyState radius={radius} days={days} />
        ) : (
          <Suspense key={`${location}|${radius}|${days}`} fallback={<LoadingStage />}>
            <SearchResults location={location} radius={radius} days={days} />
          </Suspense>
        )}
      </div>
    </main>
  )
}
