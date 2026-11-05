import { cn } from '@/lib/utils'

/**
 * The 0–10 jam score as a meter.
 *
 * A single ratio against a limit is a meter, not a chart: one hue, the unfilled
 * track a light step of the same ramp so the state reads across the whole bar.
 * The number is always visible, so the colour is never the only encoding.
 */

/** Maps a score to its ordinal tier. Mirrors BANDS in scoring/weights.ts. */
export function scoreTier(score: number): 1 | 2 | 3 | 4 {
  if (score >= 8) return 4
  if (score >= 6) return 3
  if (score >= 4) return 2
  return 1
}

const TIER_FILL: Record<1 | 2 | 3 | 4, string> = {
  4: 'var(--score-4)',
  3: 'var(--score-3)',
  2: 'var(--score-2)',
  1: 'var(--score-1)',
}

type Props = {
  score: number
  label: string
  /** Renders the compact form used in list rows. */
  compact?: boolean
  className?: string
}

export function ScoreMeter({ score, label, compact = false, className }: Props) {
  const tier = scoreTier(score)
  const pct = Math.max(0, Math.min(score / 10, 1)) * 100

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5', className)}>
      <div className="flex items-baseline gap-2">
        <span
          className={cn('tabular font-semibold leading-none', compact ? 'text-xl' : 'text-3xl')}
          style={{ color: TIER_FILL[tier] }}
        >
          {score.toFixed(1)}
        </span>
        <span className="text-xs text-[var(--ink-muted)] leading-none">/ 10</span>
      </div>

      {/* 4px rounded data-end anchored to the baseline; track is the same ramp. */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--score-track)' }}
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label={`Jam score ${score.toFixed(1)} out of 10 — ${label}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: TIER_FILL[tier] }}
        />
      </div>

      {!compact && (
        <span className="text-xs font-medium text-[var(--ink-secondary)]">{label}</span>
      )}
    </div>
  )
}
