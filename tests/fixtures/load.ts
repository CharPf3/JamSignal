import { readFileSync } from 'node:fs'

/** One labelled artist, as captured from the live APIs. */
export type LabelledArtist = {
  name: string
  label: 'jam' | 'pool' | 'borderline'
  source: string
  tags: Array<{ name: string; count: number }>
  similar: Array<{ name: string; match: number }>
  setlist: {
    resolved: boolean
    shows: number
    coreCoversPerShow: number
    showsWithCore: number
    topCovers: string[]
  }
  mb: { name: string; disambiguation: string | null; jamDisambiguation: boolean; ambiguous: boolean } | null
}

/**
 * The labelled set: verbatim Last.fm, MusicBrainz and setlist.fm responses for
 * 471 artists. Positives are curated jam acts; negatives are the real
 * Ticketmaster candidate pool harvested across ten cities, which is the
 * distribution the model actually faces. Contested acts are labelled
 * `borderline` and excluded from fitting — see label-decisions.json.
 *
 * Newline-delimited so the file diffs one artist at a time.
 */
export function loadLabelledArtists(): LabelledArtist[] {
  const raw = readFileSync(new URL('./labelled-artists.json', import.meta.url), 'utf8')
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LabelledArtist)
}
