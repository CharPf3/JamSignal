/**
 * Concurrency and rate-limiting primitives.
 *
 * Every upstream API JamSignal uses has a published per-second limit. Exceeding
 * it does not fail loudly — Ticketmaster returns 429 and the old code dropped
 * those responses silently, so a third of the search space vanished at random
 * on every run. Requests go through `throttle` + `retry` so a limit produces a
 * delay, never a missing result.
 */

/** Pause for `ms`. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Serialises calls to a fixed rate. Unlike a fixed `sleep` between awaits, a
 * token bucket lets bursts through up to `perSecond` and only delays once the
 * budget is spent, so the common case (few artists, warm cache) pays nothing.
 */
export function throttle(perSecond: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const minGap = 1000 / perSecond
  let next = 0

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now()
    const start = Math.max(now, next)
    next = start + minGap
    if (start > now) await sleep(start - now)
    return fn()
  }
}

export type RetryOptions = {
  attempts?: number
  /** Base delay in ms; doubles each attempt. */
  backoffMs?: number
  /** Return true to retry. Defaults to retrying any thrown error. */
  retryOn?: (err: unknown) => boolean
  onRetry?: (attempt: number, err: unknown) => void
}

/**
 * Retries with exponential backoff and jitter. Jitter matters because a search
 * fans out many requests at once; without it, retries re-collide in lockstep.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, backoffMs = 500, retryOn = () => true, onRetry } = options
  let lastErr: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === attempts || !retryOn(err)) break
      onRetry?.(attempt, err)
      const base = backoffMs * 2 ** (attempt - 1)
      await sleep(base + Math.random() * base * 0.3)
    }
  }

  throw lastErr
}

/**
 * Maps over `items` with at most `limit` promises in flight.
 *
 * Results keep input order regardless of completion order — scoring must not
 * depend on which request happened to finish first.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const results = new Array<R>(items.length)
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Collapses concurrent calls for the same key onto one in-flight promise.
 *
 * A single search can reference the same artist from several events; without
 * this, each one issues its own identical request.
 */
export function dedupe<A extends readonly unknown[], R>(
  keyOf: (...args: A) => string,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  const inFlight = new Map<string, Promise<R>>()

  return (...args: A): Promise<R> => {
    const key = keyOf(...args)
    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = fn(...args).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}
