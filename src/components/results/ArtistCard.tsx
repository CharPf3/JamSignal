'use client'

import { useId, useState } from 'react'
import { AlertCircle, Calendar, ChevronDown, ExternalLink, MapPin, Navigation } from 'lucide-react'
import { ScoreMeter } from '@/components/score/ScoreMeter'
import { SignalBreakdown } from '@/components/score/SignalBreakdown'
import type { ArtistGroup } from '@/types'
import { cn } from '@/lib/utils'

/**
 * One artist, with every show they are playing in range.
 *
 * Results were previously one card per event, so a band playing five nights
 * produced five identical cards with the same explanation repeated. Grouping by
 * artist matches how the question is actually asked — who is worth seeing — and
 * leaves the dates as the detail.
 */

function formatDate(date: string, time: string | null): string {
  // Noon avoids the date shifting under UTC conversion.
  const parsed = new Date(`${date}T${time ?? '12:00:00'}`)
  const day = parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  if (!time) return day
  return `${day}, ${parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

type Props = { group: ArtistGroup }

export function ArtistCard({ group }: Props) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const hasBreakdown = group.signals.length > 0

  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold leading-tight text-[var(--ink)]">
              {group.artist_name}
            </h3>

            {group.reasons.length > 0 && (
              <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">
                {group.reasons[0]}
              </p>
            )}
          </div>

          {group.notable_songs.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Canon songs in recent setlists">
              {group.notable_songs.slice(0, 5).map((song) => (
                <li
                  key={song}
                  className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-[var(--ink-secondary)]"
                >
                  {song}
                </li>
              ))}
            </ul>
          )}

          {group.name_ambiguous && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--ink-muted)]">
              <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
              Several artists share this name, so genre data may be incomplete.
            </p>
          )}

          {/* Shows */}
          <ul className="space-y-1.5 pt-0.5">
            {group.events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular flex items-center gap-1.5 font-medium text-[var(--ink)]">
                  <Calendar size={13} className="shrink-0 text-[var(--ink-muted)]" aria-hidden />
                  {formatDate(event.date, event.start_time)}
                </span>

                <span className="flex min-w-0 items-center gap-1.5 text-[var(--ink-secondary)]">
                  <MapPin size={13} className="shrink-0 text-[var(--ink-muted)]" aria-hidden />
                  <span className="truncate">
                    {event.venue_name}
                    {event.venue_city && (
                      <span className="text-[var(--ink-muted)]">
                        {' · '}
                        {[event.venue_city, event.venue_state].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </span>
                </span>

                {event.distance_miles !== null && (
                  <span className="tabular flex items-center gap-1 text-xs text-[var(--ink-muted)]">
                    <Navigation size={11} className="shrink-0" aria-hidden />
                    {event.distance_miles} mi
                  </span>
                )}

                {event.ticket_url && (
                  <a
                    href={event.ticket_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  >
                    Tickets
                    <ExternalLink size={10} aria-hidden />
                    <span className="sr-only">
                      for {group.artist_name} at {event.venue_name} on {event.date}
                    </span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>

        <ScoreMeter
          score={group.score}
          label={group.score_label}
          className="w-24 shrink-0 sm:w-28"
        />
      </div>

      {hasBreakdown && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 border-t border-[var(--border)]',
              'bg-[var(--surface-sunken)] px-4 py-2 text-xs font-medium',
              'text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink)]'
            )}
          >
            {expanded ? 'Hide' : 'Why this score'}
            <ChevronDown
              size={13}
              aria-hidden
              className={cn('transition-transform', expanded && 'rotate-180')}
            />
          </button>

          {expanded && (
            <div id={panelId} className="space-y-3 border-t border-[var(--border)] px-4 py-4 sm:px-5">
              <SignalBreakdown signals={group.signals} />

              {group.reasons.length > 1 && (
                <ul className="space-y-1 text-xs text-[var(--ink-muted)]">
                  {group.reasons.slice(1).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}

              {group.attribution_url && (
                <p className="text-xs text-[var(--ink-muted)]">
                  Setlist data from{' '}
                  <a
                    href={group.attribution_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--accent)]"
                  >
                    setlist.fm
                  </a>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}
