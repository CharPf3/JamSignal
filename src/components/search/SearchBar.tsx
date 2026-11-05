'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Search } from 'lucide-react'
import { LocationInput } from './LocationInput'
import { cn } from '@/lib/utils'

/**
 * The search controls.
 *
 * Navigation carries the search, so `useTransition` gives the pending state —
 * no local fetch, no duplicated loading flag. Radius and date range were
 * previously a radius dropdown and a `days` value hardcoded to 60 that the UI
 * never exposed; both are now the user's.
 */

const RADIUS_OPTIONS = [25, 50, 100, 150, 250] as const
const DAY_OPTIONS = [
  { value: 14, label: 'Next 2 weeks' },
  { value: 30, label: 'Next month' },
  { value: 60, label: 'Next 2 months' },
  { value: 120, label: 'Next 4 months' },
] as const

const controlClass = cn(
  'rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-3',
  'text-sm text-[var(--ink)] outline-none transition-colors',
  'focus:border-[var(--focus)] disabled:opacity-50'
)

type Props = { location: string; radius: number; days: number }

export function SearchBar({ location: initialLocation, radius: initialRadius, days: initialDays }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [location, setLocation] = useState(initialLocation)
  const [radius, setRadius] = useState(initialRadius)
  const [days, setDays] = useState(initialDays)

  function go(overrides: Partial<Props> = {}) {
    const next = { location, radius, days, ...overrides }
    if (next.location.trim().length < 2) return

    const query = new URLSearchParams({
      location: next.location.trim(),
      radius: String(next.radius),
      days: String(next.days),
    })
    startTransition(() => router.push(`/?${query}`))
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        go()
      }}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <LocationInput
        value={location}
        onChange={setLocation}
        // Picking a suggestion is an explicit choice — search immediately.
        onSelect={(place) => {
          setLocation(place.label)
          go({ location: place.label })
        }}
        disabled={pending}
      />

      <div className="flex gap-3">
        <label className="sr-only" htmlFor="radius">
          Search radius
        </label>
        <select
          id="radius"
          value={radius}
          onChange={(event) => {
            const value = Number(event.target.value)
            setRadius(value)
            go({ radius: value })
          }}
          disabled={pending}
          className={controlClass}
        >
          {RADIUS_OPTIONS.map((miles) => (
            <option key={miles} value={miles}>
              {miles} mi
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="days">
          Date range
        </label>
        <select
          id="days"
          value={days}
          onChange={(event) => {
            const value = Number(event.target.value)
            setDays(value)
            go({ days: value })
          }}
          disabled={pending}
          className={cn(controlClass, 'flex-1')}
        >
          {DAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending || location.trim().length < 2}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-5 py-3',
            'text-sm font-medium transition-all active:scale-[0.98]',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {pending ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : (
            <Search size={16} aria-hidden />
          )}
          <span className="hidden sm:inline">{pending ? 'Searching' : 'Find shows'}</span>
        </button>
      </div>
    </form>
  )
}
