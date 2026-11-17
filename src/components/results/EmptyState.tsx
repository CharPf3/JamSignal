import Link from 'next/link'

/** Shown before any search. The suggestions are real links, so they prefetch. */

const SUGGESTIONS = ['Madison, WI', 'Denver, CO', 'Burlington, VT', 'Asheville, NC', 'San Francisco, CA']

export function EmptyState({ radius, days }: { radius: number; days: number }) {
  return (
    <div className="space-y-6 py-10 text-center">
      <div className="space-y-2">
        <p className="font-medium text-[var(--ink)]">Enter a location to find shows.</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
          JamSignal checks who is playing near you, then scores each artist on
          genre tags, listener similarity and what they have actually played
          live. Every score shows its own reasoning.
        </p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((city) => (
          <li key={city}>
            <Link
              href={`/?location=${encodeURIComponent(city)}&radius=${radius}&days=${days}`}
              className="block rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink-secondary)] transition-colors hover:border-[var(--focus)] hover:text-[var(--ink)]"
            >
              {city}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
