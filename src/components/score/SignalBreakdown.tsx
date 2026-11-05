import type { ScoreSignal } from '@/types'
import { cn } from '@/lib/utils'

/**
 * Where the score came from, one row per evidence family.
 *
 * The model is logistic, so its per-feature contributions are log-odds and do
 * not sum to the score. Presenting them as "points out of a maximum" would
 * misstate the arithmetic. Each row instead shows that family's share of the
 * positive evidence, which is true and answers what the reader is asking:
 * what made this one rank high?
 *
 * A list rather than a stacked bar: the families carry identity, not
 * magnitude, and with the detail text beside each one a table reads better
 * than more colours would.
 */

type Props = {
  signals: ScoreSignal[]
  className?: string
}

export function SignalBreakdown({ signals, className }: Props) {
  if (signals.length === 0) return null

  return (
    <table className={cn('w-full border-separate border-spacing-y-1.5 text-xs', className)}>
      <caption className="sr-only">
        Share of the evidence behind this score, by source
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Share of evidence</th>
          <th scope="col">What was found</th>
        </tr>
      </thead>
      <tbody>
        {signals.map((signal) => (
          <tr key={signal.key}>
            <th
              scope="row"
              className="w-[9.5rem] pr-3 text-left align-middle font-medium whitespace-nowrap text-[var(--ink-secondary)]"
            >
              {signal.label}
            </th>

            <td className="w-24 align-middle">
              <div className="flex items-center gap-2">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full"
                  style={{ background: 'var(--score-track)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(signal.weight * 100)}%`, background: 'var(--score-3)' }}
                  />
                </div>
                <span className="tabular w-8 text-right text-[var(--ink-muted)]">
                  {Math.round(signal.weight * 100)}%
                </span>
              </div>
            </td>

            <td className="pl-3 align-middle text-[var(--ink-muted)]">
              {signal.detail ?? <span className="sr-only">no detail</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
