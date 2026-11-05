/**
 * The Suspense fallback.
 *
 * The old UI spun an icon in the submit button and showed nothing else for 25
 * to 140 seconds, with no indication that anything was happening.
 *
 * An earlier version of this component advanced through staged messages on
 * timers. Watching it in the browser, the text never moved past the first
 * stage: the fallback is server-rendered and flushed immediately, but its
 * client JavaScript does not hydrate while the server is still streaming the
 * real content, so the timers never fire. Rather than ship animation that
 * cannot run, this is one honest sentence and a skeleton — no client component
 * at all.
 */
export function LoadingStage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ink-secondary)]" role="status" aria-live="polite">
        Finding shows near you. Artists we have not seen before are analysed on
        first search, which takes a little longer.
      </p>

      <div className="space-y-3" aria-hidden>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5"
            style={{ opacity: 1 - row * 0.25 }}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1 space-y-2.5">
                <div className="h-4 w-2/5 animate-pulse rounded bg-[var(--surface-sunken)]" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--surface-sunken)]" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-[var(--surface-sunken)]" />
              </div>
              <div className="w-24 space-y-1.5">
                <div className="h-6 w-12 animate-pulse rounded bg-[var(--surface-sunken)]" />
                <div className="h-1.5 w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
