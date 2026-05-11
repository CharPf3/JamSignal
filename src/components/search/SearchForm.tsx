'use client'

import { useState } from 'react'
import { Search, MapPin, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const RADIUS_OPTIONS = [25, 50, 100, 150, 200] as const

type Props = {
  onSearch: (location: string, radius: number) => void
  loading: boolean
}

export function SearchForm({ onSearch, loading }: Props) {
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState<number>(50)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (location.trim().length < 2 || loading) return
    onSearch(location.trim(), radius)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Location input */}
        <div className="relative flex-1">
          <MapPin
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
          />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, state or zip code"
            autoComplete="off"
            disabled={loading}
            className={cn(
              'w-full pl-9 pr-4 py-3 rounded-xl border border-[var(--border)]',
              'bg-white text-[var(--foreground)] placeholder:text-[var(--muted)]',
              'text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400',
              'disabled:opacity-50 transition-all'
            )}
          />
        </div>

        {/* Radius select */}
        <select
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          disabled={loading}
          className={cn(
            'px-4 py-3 rounded-xl border border-[var(--border)]',
            'bg-white text-[var(--foreground)] text-sm',
            'focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400',
            'disabled:opacity-50 transition-all cursor-pointer'
          )}
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r} mi
            </option>
          ))}
        </select>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || location.trim().length < 2}
          className={cn(
            'flex items-center justify-center gap-2 px-6 py-3 rounded-xl',
            'bg-amber-500 text-white font-medium text-sm',
            'hover:bg-amber-600 active:scale-[0.98]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-all'
          )}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          {loading ? 'Searching…' : 'Find Shows'}
        </button>
      </div>
    </form>
  )
}
