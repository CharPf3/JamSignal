import { EventCard } from './EventCard'
import type { EventResult } from '@/types'

type Props = {
  events: EventResult[]
  location: string
  radius: number
}

export function EventList({ events, location, radius }: Props) {
  if (events.length === 0) {
    return (
      <div className="text-center py-16 space-y-2">
        <p className="text-[var(--foreground)] font-medium">No shows found nearby.</p>
        <p className="text-sm text-[var(--muted)]">
          Try expanding your radius or searching a nearby city.
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        <span className="font-medium text-[var(--foreground)]">{events.length}</span> shows found
        within {radius} mi of {location}
      </p>

      <div className="space-y-3">
        {events.map((event) => (
          <EventCard key={`${event.source}-${event.id}`} event={event} />
        ))}
      </div>
    </section>
  )
}
