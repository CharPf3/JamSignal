/**
 * JSON fetch with rate-limit awareness.
 *
 * `HttpError` carries the status so callers can distinguish "this artist has no
 * setlists" (404 — a real, cacheable answer) from "we were throttled" (429 — a
 * missing answer that must be retried, never cached).
 */

import { retry, type RetryOptions } from './concurrency'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(`HTTP ${status} for ${stripSecrets(url)}`)
    this.name = 'HttpError'
  }

  /** Throttled or upstream failure — the request should be retried. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** Keeps API keys out of logs and error messages. */
export function stripSecrets(url: string): string {
  return url.replace(/([?&])(apikey|api_key|key)=[^&]*/gi, '$1$2=***')
}

export type JsonOptions = {
  headers?: Record<string, string>
  /** Next.js fetch cache revalidation window, in seconds. */
  revalidate?: number | false
  timeoutMs?: number
  retry?: RetryOptions
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Fetches JSON, retrying transient failures with backoff.
 *
 * Throws `HttpError` on a non-OK response so no caller can mistake an error for
 * an empty result — the bug that made rate limits invisible.
 */
export async function fetchJson<T>(url: string, options: JsonOptions = {}): Promise<T> {
  const { headers, revalidate, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options

  const attempt = async (): Promise<T> => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const res = await fetch(url, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(revalidate === false
        ? { cache: 'no-store' as const }
        : revalidate !== undefined
          ? { next: { revalidate } }
          : {}),
    })

    if (!res.ok) {
      throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('retry-after')))
    }

    return res.json() as Promise<T>
  }

  return retry(attempt, {
    attempts: 3,
    backoffMs: 600,
    retryOn: (err) => !(err instanceof HttpError) || err.isTransient,
    ...options.retry,
  })
}

/**
 * Like `fetchJson`, but returns null for a definitive "nothing here" rather
 * than throwing. Transient failures still throw — an empty result and a dropped
 * request must stay distinguishable.
 */
export async function fetchJsonOrNull<T>(url: string, options: JsonOptions = {}): Promise<T | null> {
  try {
    return await fetchJson<T>(url, options)
  } catch (err) {
    if (err instanceof HttpError && !err.isTransient) return null
    throw err
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}
