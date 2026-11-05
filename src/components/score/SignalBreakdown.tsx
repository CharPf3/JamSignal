import type { ScoreSignal } from '@/types'
import { cn } from '@/lib/utils'

/**
 * Where the score came from, one row per signal.
 *
 * Eight signals can contribute, which is past the point where more colours help
 * — beyond roughly seven classes the right form is a table, not a wider palette.
 * So this is a list: label, a thin magnitude bar against that signal's ceiling,
 * the points, and what was actually measured. One hue throughout, because the
 * bars encode magnitude rather than identity; the label carries identity.
 *
 * The rows sum to the score, so the number is never opaque. That is the point:
 * the previous model exposed a single figure with no account of itself.
 */

type Props = {
  signals: ScoreSignal[]
  className?: string
}

export function SignalBreakdown({ signals, className }: Props) {
  if (signals.length === 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <table className="w-full border-separate border-spacing-y-1.5 text-xs">
        <caption className="sr-only">
          Jam score breakdown by signal, with points contributed out of each signal&rsquo;s maximum
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Strength</th>
            <th scope="col">Points</th>
            <th scope="col">What was measured</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.key}>
              <th
                scope="row"
                className="w-[7.5rem] pr-3 text-left align-middle font-medium text-[var(--ink-secondary)] whitespace-nowrap"
              >
                {signal.label}
              </th>

              <td className="w-20 align-middle">
                <div
                  className="h-1 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--score-track)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(signal.points / signal.max, 1) * 100}%`,
                      background: 'var(--score-3)',
                    }}
                  />
                </div>
              </td>

              <td className="tabular w-14 pl-2 pr-3 text-right align-middle text-[var(--ink-secondary)]">
                +{signal.points.toFixed(1)}
              </td>

              <td className="align-middle text-[var(--ink-muted)]">
                {signal.detail ?? <span className="sr-only">no detail</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
