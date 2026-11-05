/**
 * Last.fm — the strongest available signal.
 *
 * Measured on 55 labelled artists (30 jam acts, 25 country/folk/blues acts that
 * surface in the same Ticketmaster searches):
 *
 *   rank-weighted jam tags       AUC 0.957   mean 0.91 jam vs 0.01 non-jam
 *   similar-artist affinity      AUC 0.923   mean 3.19 jam vs 0.27 non-jam
 *
 * Two things matter about how the tag signal is computed.
 *
 * First, RANK. Last.fm returns tags with a `count` relative to the artist's top
 * tag. A "jam band" tag at rank 1 means the listener base agrees; the same tag
 * at rank 40 is a handful of votes. The previous implementation summed fixed
 * weights and ignored count entirely.
 *
 * Second, SATURATION. Summing adjacency weights let unrelated genres stack to
 * the ceiling: blues + funk + soul + southern rock + roots rock + progressive
 * rock reached a full 10/10 jam score, which cleared the display threshold. The
 * direct and adjacent families are now scored separately, and adjacency is
 * capped well below what a single direct tag earns, so stacking cannot
 * substitute for being tagged a jam band.
 */

import { env } from '@/lib/core/env'
import { fetchJson } from '@/lib/core/http'
import { throttle } from '@/lib/core/concurrency'
import { normalizeName } from '@/lib/canon/normalize'
import { SEED_ACTS } from '@/lib/canon/acts'

export type LastFmData = {
  /** Top tags, most-used first. */
  tags: string[]
  /**
   * Rank-weighted strength of direct jam tags, 0–1. A top-ranked "jam band"
   * tag approaches 1.0.
   */
  jamTagStrength: number
  /** Rank-weighted strength of adjacent genre tags, 0–1. Deliberately capped. */
  adjacentTagStrength: number
  /** Which tags contributed, for display and debugging. */
  matchedTags: string[]
  /** Summed Last.fm similarity to seed jam acts. Unbounded; typically 0–8. */
  similarityAffinity: number
  /** Seed acts found among this artist's similar artists. */
  similarSeeds: string[]
  found: boolean
}

export const EMPTY_LASTFM: LastFmData = {
  tags: [],
  jamTagStrength: 0,
  adjacentTagStrength: 0,
  matchedTags: [],
  similarityAffinity: 0,
  similarSeeds: [],
  found: false,
}

/**
 * Tags that identify the tradition directly. Normalised exact matches — the old
 * substring test meant the tag "jamaican" matched "jam".
 */
const DIRECT_TAGS = new Set([
  'jam band', 'jamband', 'jam bands', 'jambands', 'jam rock', 'jam',
  'jamgrass', 'jam grass', 'improvisational', 'improvisation',
  'newgrass', 'progressive bluegrass', 'electronic jam', 'livetronica',
])

/**
 * Adjacent genres. Real supporting evidence, but a band can be all of these and
 * not be a jam band, so their total contribution is capped.
 */
const ADJACENT_TAGS = new Set([
  'psychedelic rock', 'psychedelia', 'psychedelic', 'neo-psychedelic',
  'acid rock', 'bluegrass', 'americana', 'folk rock', 'southern rock',
  'roots rock', 'progressive rock', 'country rock', 'blues rock', 'funk',
  'funk rock', 'jazz fusion', 'fusion',
])

/** Meta-tags carrying no genre information. */
const SKIP_TAGS = new Set([
  'seen live', 'favourites', 'favorites', 'favorite', 'love', 'awesome',
  'beautiful', 'amazing', 'good', 'best', 'classic', 'all', 'usa',
  'american', 'under 2000 listeners', 'male vocalists', 'female vocalists',
  'rock', 'indie', 'alternative', 'pop',
])

/** Adjacency can contribute at most this much, before weighting. */
const ADJACENT_CEILING = 0.35

/** Last.fm permits roughly 5 requests per second per key. */
const limit = throttle(4)

const SEED_NAMES = new Set(SEED_ACTS.map(normalizeName))

type TagsResponse = {
  toptags?: { tag?: Array<{ name: string; count: number }> }
  error?: number
}

type SimilarResponse = {
  similarartists?: { artist?: Array<{ name: string; match: string }> }
  error?: number
}

async function call<T>(params: Record<string, string>): Promise<T | null> {
  const apiKey = env.lastfmKey()
  if (!apiKey) return null

  const query = new URLSearchParams({ ...params, api_key: apiKey, format: 'json', autocorrect: '1' })
  return limit(() =>
    fetchJson<T>(`https://ws.audioscrobbler.com/2.0/?${query}`, {
      revalidate: 60 * 60 * 24 * 7,
    })
  ).catch(() => null)
}

/**
 * Scores tags by rank. `count` is relative to the artist's top tag, so dividing
 * by it yields each tag's agreement share.
 */
export function scoreTags(raw: Array<{ name: string; count: number }>) {
  const top = Math.max(...raw.map((t) => t.count), 1)

  let direct = 0
  let adjacent = 0
  const matched: string[] = []
  const tags: string[] = []

  for (const { name, count } of raw) {
    const tag = name.toLowerCase().trim()
    if (SKIP_TAGS.has(tag)) continue
    tags.push(tag)

    const share = count / top
    if (DIRECT_TAGS.has(tag)) {
      direct = Math.max(direct, share) // best direct tag wins; they don't stack
      matched.push(tag)
    } else if (ADJACENT_TAGS.has(tag)) {
      adjacent += share * 0.12 // many weak votes, heavily damped
      matched.push(tag)
    }
  }

  return {
    tags: tags.slice(0, 12),
    jamTagStrength: Math.min(direct, 1),
    adjacentTagStrength: Math.min(adjacent, ADJACENT_CEILING),
    matchedTags: matched.slice(0, 6),
  }
}

/**
 * Measures how close an artist sits to the seed jam acts in Last.fm's
 * similarity graph.
 *
 * This is the discovery mechanism a hardcoded name list cannot provide: it
 * generalises to bands nobody has typed in yet.
 */
export function scoreSimilar(raw: Array<{ name: string; match: string }>) {
  let affinity = 0
  const seeds: string[] = []

  for (const { name, match } of raw) {
    if (!SEED_NAMES.has(normalizeName(name))) continue
    affinity += Number.parseFloat(match) || 0
    seeds.push(name)
  }

  return { similarityAffinity: Number(affinity.toFixed(3)), similarSeeds: seeds.slice(0, 6) }
}

/** Fetches tags and similar artists for an artist name. */
export async function getLastFmData(artistName: string): Promise<LastFmData> {
  const [tagsRes, similarRes] = await Promise.all([
    call<TagsResponse>({ method: 'artist.gettoptags', artist: artistName }),
    call<SimilarResponse>({ method: 'artist.getsimilar', artist: artistName, limit: '50' }),
  ])

  const rawTags = tagsRes?.error ? [] : (tagsRes?.toptags?.tag ?? [])
  const rawSimilar = similarRes?.error ? [] : (similarRes?.similarartists?.artist ?? [])

  if (rawTags.length === 0 && rawSimilar.length === 0) return EMPTY_LASTFM

  return {
    ...scoreTags(rawTags),
    ...scoreSimilar(rawSimilar),
    found: true,
  }
}
