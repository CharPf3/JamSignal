import { Calendar, MapPin, ExternalLink, Navigation } from 'lucide-react'
import type { EventResult } from '@/types'

type Props = {
  event: EventResult
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00') // avoid UTC offset issues
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null

  const label = score >= 8 ? 'High' : score >= 5 ? 'Likely' : 'Possible'
  const colors =
    score >= 8
      ? 'bg-amber-100 text-amber-800'
      : score >= 5
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-stone-100 text-stone-600'

  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors}`}>
      {label} · {score.toFixed(1)}
    </span>
  )
}

export function EventCard({ event }: Props) {
  const location = [event.venue_city, event.venue_state].filter(Boolean).join(', ')

  return (
    <article className="group bg-white rounded-2xl border border-[var(--border)] p-5 hover:border-amber-300 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Band name */}
          <h3 className="font-semibold text-[var(--foreground)] text-base leading-tight truncate">
            {event.band_name}
          </h3>

          {/* Venue + location */}
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">
              {event.venue_name}
              {location && (
                <span className="text-[var(--muted)]/70"> · {location}</span>
              )}
            </span>
          </div>

          {/* Date */}
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
            <Calendar size={13} className="shrink-0" />
            <span>{formatDate(event.date)}</span>
          </div>

          {/* Distance */}
          {event.distance_miles !== null && (
            <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
              <Navigation size={13} className="shrink-0" />
              <span>{Math.round(event.distance_miles)} mi away</span>
            </div>
          )}

          {/* AI explanation */}
          {event.ai_explanation && (
            <p className="text-sm text-[var(--muted)] italic mt-1 leading-relaxed">
              "{event.ai_explanation}"
            </p>
          )}

          {/* Notable setlist songs */}
          {event.setlist_jam_songs.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {event.setlist_jam_songs.slice(0, 4).map((song) => (
                <span
                  key={song}
                  className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full"
                >
                  {song}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-3 shrink-0">
          <ConfidenceBadge score={event.confidence_score} />

          {event.ticket_url && (
            <a
              href={event.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              Tickets
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </article>
  )
}
