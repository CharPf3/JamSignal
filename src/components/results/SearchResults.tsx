import { search } from '@/lib/pipeline'
import { APERTURES, type ApertureName } from '@/lib/scoring/aperture'
import { ResultsList } from './ResultsList'

/**
 * Runs the search on the server and renders it.
 *
 * Calling the pipeline directly removes a network hop: the browser previously
 * fetched `/api/events`, which called this same code. The route still exists
 * for programmatic use, but the page does not go through it.
 */
export async function SearchResults({
  location,
  radius,
  days,
  aperture,
}: {
  location: string
  radius: number
  days: number
  aperture: ApertureName
}) {
  const result = await search({
    location,
    radiusMiles: radius,
    days,
    minScore: APERTURES[aperture].minScore,
  })

  if (!result.ok) {
    return (
      <div className="space-y-2 py-10 text-center">
        <p className="font-medium text-[var(--ink)]">{result.error}</p>
        <p className="text-sm text-[var(--ink-muted)]">
          Edit the search above and try again.
        </p>
      </div>
    )
  }

  return <ResultsList data={result.data} aperture={aperture} />
}
