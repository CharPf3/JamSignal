'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, LocateFixed, MapPin } from 'lucide-react'
import type { GeocodedLocation } from '@/types'
import { cn } from '@/lib/utils'

/**
 * Location input with autocomplete and a "use my location" control.
 *
 * The previous search box took free text and committed to one silent
 * interpretation — Nominatim's five results, filtered by whichever happened to
 * carry a city field. The user never saw what was actually searched and had no
 * way to correct it. This shows the ranked candidates and lets them pick.
 */

const DEBOUNCE_MS = 250
/** Nominatim allows one request per second; stay well inside that. */
const MIN_QUERY_LENGTH = 3

type Props = {
  value: string
  onChange: (value: string) => void
  onSelect: (location: GeocodedLocation) => void
  disabled?: boolean
}

export function LocationInput({ value, onChange, onSelect, disabled }: Props) {
  const [suggestions, setSuggestions] = useState<GeocodedLocation[]>([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [locating, setLocating] = useState(false)
  const listId = useId()

  // Set when the user picks a suggestion or geolocates, so the resulting value
  // change does not immediately reopen the menu.
  const suppress = useRef(false)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (suppress.current) {
      suppress.current = false
      return
    }

    const controller = new AbortController()
    const query = value.trim()

    // The effect only schedules; every state write happens in the timer, after
    // the render has committed.
    const timer = setTimeout(async () => {
      if (query.length < MIN_QUERY_LENGTH) {
        setSuggestions([])
        setOpen(false)
        return
      }
      try {
        const res = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const data: { locations: GeocodedLocation[] } = await res.json()
        setSuggestions(data.locations)
        setHighlighted(-1)
        setOpen(data.locations.length > 0)
      } catch {
        // Aborted or offline — leave the previous suggestions in place.
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  function choose(location: GeocodedLocation) {
    suppress.current = true
    onChange(location.label)
    setOpen(false)
    setSuggestions([])
    onSelect(location)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((i) => (i + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (event.key === 'Enter' && highlighted >= 0) {
      event.preventDefault()
      choose(suggestions[highlighted]!)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  async function useMyLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords
          const res = await fetch(`/api/locations?lat=${latitude}&lon=${longitude}`)
          if (res.ok) {
            const data: { locations: GeocodedLocation[] } = await res.json()
            if (data.locations[0]) choose(data.locations[0])
          }
        } finally {
          setLocating(false)
        }
      },
      () => setLocating(false),
      { timeout: 10_000 }
    )
  }

  return (
    <div ref={wrapper} className="relative flex-1">
      <MapPin
        size={16}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"
      />

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="City, state or ZIP"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
        className={cn(
          'w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] py-3 pl-9 pr-11',
          'text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)]',
          'outline-none transition-colors focus:border-[var(--focus)]',
          'disabled:opacity-50'
        )}
      />

      <button
        type="button"
        onClick={useMyLocation}
        disabled={disabled || locating}
        title="Use my location"
        aria-label="Use my location"
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2',
          'text-[var(--ink-muted)] transition-colors hover:text-[var(--accent)]',
          'disabled:opacity-50'
        )}
      >
        {locating ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} />}
      </button>

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            'absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-[var(--border-strong)]',
            'bg-[var(--surface)] py-1 shadow-lg'
          )}
        >
          {suggestions.map((location, index) => (
            <li key={`${location.latitude},${location.longitude}`} role="none">
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(location)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                  index === highlighted ? 'bg-[var(--surface-sunken)]' : 'bg-transparent'
                )}
              >
                <span className="text-sm font-medium text-[var(--ink)]">{location.label}</span>
                <span className="line-clamp-1 text-xs text-[var(--ink-muted)]">
                  {location.display_name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
