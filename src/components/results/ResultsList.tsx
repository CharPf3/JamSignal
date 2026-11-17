import Link from 'next/link'
import { ChevronRight, Info } from 'lucide-react'
import { ArtistCard } from './ArtistCard'
import type { ArtistGroup, SearchResponse } from '@/types'

/**
 * Results, with the coverage of the search stated rather than implied.
 *
 * The old UI printed "N shows found" and nothing else, which presented a
 * partial result as a complete one. At the time, a third of the Ticketmaster
 * queries were being dropped to rate limiting on every run and artists beyond
 * a budget were silently unscored. When coverage is incomplete now, it says so.
 */

type Props = { data: SearchResponse }

export function ResultsList({ data }: Props) {
  const { groups, marginal, diagnostics, location, radius } = data

  if (groups.length === 0) {
    return (
      <div className="space-y-4 py-12 text-center">
        <div className="space-y-1.5">
          <p className="font-medium text-[var(--ink)]">
            No jam shows found near {location.label}.
          </p>
          <p className="text-sm text-[var(--ink-muted)]">
            {diagnostics.raw_events > 0
              ? `Checked ${diagnostics.unique_artists} ${diagnostics.unique_artists === 1 ? 'artist' : 'artists'} playing within ${radius} miles — none had enough jam signal to surface.`
              : `No events found within ${radius} miles in this date range.`}
          </p>
        </div>

        {radius < 250 && (
          <Link
            href={`/?location=${encodeURIComponent(location.label)}&radius=${Math.min(radius * 2, 250)}&days=${data.days}`}
            className="inline-block text-sm font-medium text-[var(--accent)] underline transition-colors hover:text-[var(--accent-hover)]"
          >
            Search {Math.min(radius * 2, 250)} miles instead
          </Link>
        )}

        {marginal.length > 0 && <MarginalSection groups={marginal} />}

        <Coverage diagnostics={diagnostics} />
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--ink-secondary)]">
          <span className="font-semibold text-[var(--ink)]">{groups.length}</span>
          {groups.length === 1 ? ' artist' : ' artists'}
          {', '}
          <span className="font-semibold text-[var(--ink)]">{data.total_events}</span>
          {data.total_events === 1 ? ' show' : ' shows'}
          {' within '}
          {radius} mi of {location.label}
        </p>
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <ArtistCard key={group.artist_name} group={group} />
        ))}
      </div>

      {marginal.length > 0 && <MarginalSection groups={marginal} />}

      <Coverage diagnostics={diagnostics} />
    </section>
  )
}

/**
 * Artists scoring just below the confidence threshold.
 *
 * Separated rather than mixed in, because the measured margin between the
 * weakest real jam act and the strongest non-jam act in the validation set is
 * about 0.2 — too thin to present as a verdict. Collapsed by default so it does
 * not compete with the confident results.
 */
function MarginalSection({ groups }: { groups: ArtistGroup[] }) {
  return (
    <details className="group rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-sunken)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink)]">
        <span className="flex items-center gap-1.5">
          <ChevronRight
            size={14}
            aria-hidden
            className="transition-transform group-open:rotate-90"
          />
          {groups.length} more with a weaker signal
        </span>
      </summary>

      <div className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
        <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
          These scored below the confidence threshold. Often regional acts with
          thin reference data — worth a look, but the evidence is weaker.
        </p>
        {groups.map((group) => (
          <ArtistCard key={group.artist_name} group={group} />
        ))}
      </div>
    </details>
  )
}

/** States what the search did and did not cover. */
function Coverage({ diagnostics }: { diagnostics: SearchResponse['diagnostics'] }) {
  const notes: string[] = []

  if (diagnostics.queries_failed > 0) {
    notes.push(
      `${diagnostics.queries_failed} of ${diagnostics.queries_issued} event queries failed, so some shows may be missing.`
    )
  }
  if (diagnostics.pending_artists > 0) {
    notes.push(
      `${diagnostics.pending_artists} ${diagnostics.pending_artists === 1 ? 'artist has' : 'artists have'} not been analysed yet — search again shortly to include them.`
    )
  }
  if (diagnostics.missing_config.length > 0) {
    notes.push(`Not fully configured: ${diagnostics.missing_config.join(', ')}.`)
  }

  if (notes.length === 0) return null

  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-3 text-left">
      <Info size={14} className="mt-0.5 shrink-0 text-[var(--ink-muted)]" aria-hidden />
      <ul className="space-y-1 text-xs text-[var(--ink-muted)]">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
