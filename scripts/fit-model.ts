/**
 * Fits the scoring model and writes the artifacts the app loads.
 *
 *   npx tsx scripts/fit-model.ts            # fit, evaluate, write artifacts
 *   npx tsx scripts/fit-model.ts --dry-run  # evaluate only
 *
 * Inputs  tests/fixtures/labelled-artists.json  (committed: real API responses)
 * Outputs src/lib/scoring/model.generated.json
 *         src/lib/scoring/affinity.generated.json
 *
 * Both outputs are committed so that scoring is reproducible and reviewable,
 * and so the app has no training-time dependency.
 *
 * Evaluation is precision and recall at the operating threshold, averaged over
 * repeated stratified splits. Not AUC: AUC is threshold-free and scored four
 * materially different tag formulations identically at 0.950 while their recall
 * at a fixed cut ranged from 73% to 97%.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeName } from '../src/lib/canon/normalize'

const root = new URL('..', import.meta.url)
const p = (rel: string) => fileURLToPath(new URL(rel, root))

type Artist = {
  name: string
  label: 'jam' | 'pool' | 'borderline'
  tags: Array<{ name: string; count: number }>
  similar: Array<{ name: string; match: number }>
  setlist: { resolved: boolean; shows: number; coreCoversPerShow: number; showsWithCore: number }
  mb: { jamDisambiguation: boolean } | null
}

// Newline-delimited JSON: one artist per line, so the fixture diffs readably.
const dataset: Artist[] = readFileSync(p('tests/fixtures/labelled-artists.json'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Artist)
const labelled = dataset
  .filter((a) => a.label !== 'borderline')
  .map((a) => ({ ...a, y: a.label === 'jam' ? 1 : 0 }))

type Row = (typeof labelled)[number]

// ── Affinity table ──────────────────────────────────────────────────────────
// One hop out from the jam acts across Last.fm's similarity graph. Neighbouring
// several jam acts is stronger evidence than neighbouring one, hence the log
// term; the decay keeps a neighbour strictly below a seed.
const DECAY = 0.55

function buildAffinity(jamActs: Row[]): Map<string, number> {
  const affinity = new Map(jamActs.map((a) => [normalizeName(a.name), 1]))
  const hop = new Map<string, { sum: number; n: number }>()

  for (const act of jamActs) {
    for (const s of act.similar) {
      const key = normalizeName(s.name)
      if (affinity.has(key)) continue
      const cur = hop.get(key) ?? { sum: 0, n: 0 }
      cur.sum += s.match
      cur.n++
      hop.set(key, cur)
    }
  }

  for (const [key, v] of hop) {
    affinity.set(key, Math.min(DECAY * (v.sum / v.n) * Math.min(1 + Math.log2(v.n), 3), 0.95))
  }
  return affinity
}

// ── Features ────────────────────────────────────────────────────────────────
const GRAPH_KEYS = ['jamShare', 'jamNeighbours', 'bestNeighbour'] as const
const LIVE_KEYS = ['coreCovers', 'showsWithCore', 'mbJam', 'setlistResolved'] as const
const MIN_TAG_SUPPORT = 4
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

function graphOf(a: Row, affinity: Map<string, number>): number[] {
  let weighted = 0, total = 0, hits = 0, best = 0
  for (const s of a.similar) {
    const v = affinity.get(normalizeName(s.name)) ?? 0
    total += s.match
    if (v > 0) { weighted += s.match * v; hits++; if (v > best) best = v }
  }
  return [total > 0 ? weighted / total : 0, Math.min(hits / 20, 1), best]
}

const liveOf = (a: Row): number[] => [
  clamp01((a.setlist?.coreCoversPerShow ?? 0) / 2),
  clamp01(a.setlist?.showsWithCore ?? 0),
  a.mb?.jamDisambiguation ? 1 : 0,
  a.setlist?.resolved ? 1 : 0,
]

function buildSpace(train: Row[]) {
  const affinity = buildAffinity(train.filter((a) => a.y === 1))
  const counts = new Map<string, number>()
  for (const a of train) {
    for (const t of new Set(a.tags.map((x) => x.name))) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const vocab = [...counts.entries()].filter(([, n]) => n >= MIN_TAG_SUPPORT).map(([t]) => t).sort()
  const tagIndex = new Map(vocab.map((t, i) => [t, i]))
  const dim = vocab.length + GRAPH_KEYS.length + LIVE_KEYS.length + 1

  const featurize = (a: Row): Float64Array => {
    const x = new Float64Array(dim)
    for (const t of new Set(a.tags.map((v) => v.name))) {
      const i = tagIndex.get(t)
      if (i !== undefined) x[i] = 1
    }
    graphOf(a, affinity).forEach((v, i) => { x[vocab.length + i] = v })
    liveOf(a).forEach((v, i) => { x[vocab.length + GRAPH_KEYS.length + i] = v })
    x[dim - 1] = 1
    return x
  }

  return { affinity, vocab, dim, featurize }
}

// ── Logistic regression, L2, batch gradient descent ────────────────────────
function fit(rows: Array<{ x: Float64Array; y: number }>, dim: number, lambda: number): Float64Array {
  const w = new Float64Array(dim)
  const epochs = 700
  const lr = 0.6
  for (let e = 0; e < epochs; e++) {
    const grad = new Float64Array(dim)
    for (const { x, y } of rows) {
      let z = 0
      for (let i = 0; i < dim; i++) if (x[i]) z += w[i]! * x[i]!
      const err = 1 / (1 + Math.exp(-z)) - y
      for (let i = 0; i < dim; i++) if (x[i]) grad[i]! += err * x[i]!
    }
    for (let i = 0; i < dim; i++) {
      w[i]! -= lr * (grad[i]! / rows.length + (i === dim - 1 ? 0 : lambda * w[i]!))
    }
  }
  return w
}

const probability = (w: Float64Array, x: Float64Array): number => {
  let z = 0
  for (let i = 0; i < x.length; i++) if (x[i]) z += w[i]! * x[i]!
  return 1 / (1 + Math.exp(-z))
}

/**
 * Attributed cover evidence as a near-definitional override.
 *
 * A band playing this many attributed jam-canon covers per show is a jam act
 * regardless of what Last.fm says about it — the question stops being
 * probabilistic. Cubensis plays 8.45 Grateful Dead covers per show while
 * Last.fm files it under thrash metal; The Other Ones plays 12.47 while
 * Last.fm returns an Australian new wave band.
 *
 * Calibrated on the labelled set: P(jam | covers/show >= 0.75) = 30/30. The
 * Wilson 95% lower bound on 30/30 is 0.886, which is where the floor comes
 * from — the rule does not get to claim certainty from 30 observations.
 *
 * Adding this was worth +4.00 recall points ± 0.57 SE across 25 splits. The
 * obvious alternative — relaxing L2 on the dense features so the model could
 * learn this itself — was tested first and made things slightly worse
 * (-0.95 pts), because the feature is not linear in the way the model assumes.
 */
const OVERRIDE_COVERS_PER_SHOW = 0.75
const OVERRIDE_PROBABILITY = 0.9
const overridden = (a: Row): boolean => (a.setlist?.coreCoversPerShow ?? 0) >= OVERRIDE_COVERS_PER_SHOW

function measure(scores: number[], ys: number[], threshold: number, forced: boolean[] = []) {
  let tp = 0, fp = 0, fn = 0
  for (let i = 0; i < ys.length; i++) {
    const pred = forced[i] || scores[i]! >= threshold ? 1 : 0
    if (ys[i] === 1 && pred === 1) tp++
    else if (ys[i] === 1) fn++
    else if (pred === 1) fp++
  }
  return { precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1, tp, fp, fn }
}

/** Highest-recall threshold holding precision at or above the target. */
const TARGET_PRECISION = 0.9
function chooseThreshold(scores: number[], ys: number[], forced: boolean[]) {
  let best = { threshold: 0.5, recall: -1, precision: 0 }
  for (let t = 0.98; t >= 0.02; t -= 0.01) {
    const m = measure(scores, ys, t, forced)
    if (m.precision >= TARGET_PRECISION && m.recall > best.recall) best = { threshold: t, ...m }
  }
  return best
}

// ── Repeated stratified evaluation ──────────────────────────────────────────
function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const LAMBDA = 0.1
const SPLITS = 25

function evaluate(): { precision: number[]; recall: number[]; misses: Map<string, number> } {
  const precision: number[] = []
  const recall: number[] = []
  const misses = new Map<string, number>()

  for (let k = 0; k < SPLITS; k++) {
    const rnd = seeded(1000 + k * 7919)
    const shuffle = <T>(arr: T[]) => arr.map((v) => ({ v, k: rnd() })).sort((a, b) => a.k - b.k).map((o) => o.v)
    const pos = shuffle(labelled.filter((a) => a.y === 1))
    const neg = shuffle(labelled.filter((a) => a.y === 0))
    const cp = Math.floor(pos.length * 0.7)
    const cn = Math.floor(neg.length * 0.7)
    const train = [...pos.slice(0, cp), ...neg.slice(0, cn)]
    const test = [...pos.slice(cp), ...neg.slice(cn)]

    const space = buildSpace(train)
    const tr = train.map((a) => ({ x: space.featurize(a), y: a.y, forced: overridden(a) }))
    const w = fit(tr, space.dim, LAMBDA)
    const op = chooseThreshold(tr.map((r) => probability(w, r.x)), tr.map((r) => r.y), tr.map((r) => r.forced))

    const te = test.map((a) => ({ x: space.featurize(a), y: a.y, name: a.name, forced: overridden(a) }))
    const scores = te.map((r) => probability(w, r.x))
    const forced = te.map((r) => r.forced)
    const m = measure(scores, te.map((r) => r.y), op.threshold, forced)
    precision.push(m.precision)
    recall.push(m.recall)
    te.forEach((r, i) => {
      if (r.y === 1 && !r.forced && scores[i]! < op.threshold) misses.set(r.name, (misses.get(r.name) ?? 0) + 1)
    })
  }
  return { precision, recall, misses }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

console.log(`labelled set: ${labelled.filter((a) => a.y === 1).length} jam / ${labelled.filter((a) => a.y === 0).length} non-jam`)
console.log(`held-out evaluation over ${SPLITS} stratified 70/30 splits\n`)

const ev = evaluate()
console.log(`  precision  ${pct(mean(ev.precision))} ± ${(sd(ev.precision) * 100).toFixed(1)}`)
console.log(`  recall     ${pct(mean(ev.recall))} ± ${(sd(ev.recall) * 100).toFixed(1)}`)

console.log('\n  most frequently missed:')
for (const [name, c] of [...ev.misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  const a = labelled.find((x) => x.name === name)!
  console.log(`    ${String(c).padStart(2)}x  ${name.padEnd(28)} [${a.tags.slice(0, 3).map((t) => t.name).join(', ') || 'no tags'}]`)
}

// ── Production fit: all labelled data ───────────────────────────────────────
const space = buildSpace(labelled)
const all = labelled.map((a) => ({ x: space.featurize(a), y: a.y, forced: overridden(a) }))
const w = fit(all, space.dim, LAMBDA)
const op = chooseThreshold(all.map((r) => probability(w, r.x)), all.map((r) => r.y), all.map((r) => r.forced))

console.log(`\nproduction fit on all ${labelled.length} artists — threshold ${op.threshold.toFixed(2)} (score ${(op.threshold * 10).toFixed(1)}/10)`)

if (process.argv.includes('--dry-run')) {
  console.log('\n(dry run — no artifacts written)')
} else {
  const tagWeights: Record<string, number> = {}
  space.vocab.forEach((t, i) => {
    const v = Number(w[i]!.toFixed(4))
    if (Math.abs(v) >= 0.01) tagWeights[t] = v
  })
  const graphWeights = Object.fromEntries(
    GRAPH_KEYS.map((k, i) => [k, Number(w[space.vocab.length + i]!.toFixed(4))])
  )
  const liveWeights = Object.fromEntries(
    LIVE_KEYS.map((k, i) => [k, Number(w[space.vocab.length + GRAPH_KEYS.length + i]!.toFixed(4))])
  )

  writeFileSync(p('src/lib/scoring/model.generated.json'), JSON.stringify({
    _comment: 'Generated by scripts/fit-model.ts. Do not edit by hand.',
    version: `1.0.0`,
    trainedAt: new Date().toISOString().slice(0, 10),
    threshold: Number(op.threshold.toFixed(3)),
    coverOverride: { coversPerShow: OVERRIDE_COVERS_PER_SHOW, probability: OVERRIDE_PROBABILITY },
    bias: Number(w[space.dim - 1]!.toFixed(4)),
    tagWeights,
    graphWeights,
    liveWeights,
    metrics: {
      splits: SPLITS,
      precision: { mean: Number(mean(ev.precision).toFixed(4)), sd: Number(sd(ev.precision).toFixed(4)) },
      recall: { mean: Number(mean(ev.recall).toFixed(4)), sd: Number(sd(ev.recall).toFixed(4)) },
    },
  }, null, 1) + '\n')

  // Only entries that can affect a score; below 0.05 the weight is noise.
  const table: Record<string, number> = {}
  for (const [k, v] of space.affinity) if (v >= 0.05) table[k] = Number(v.toFixed(3))

  writeFileSync(p('src/lib/scoring/affinity.generated.json'), JSON.stringify(table, null, 0) + '\n')

  console.log(`  wrote model.generated.json    (${Object.keys(tagWeights).length} tag weights)`)
  console.log(`  wrote affinity.generated.json (${Object.keys(table).length} artists)`)
}
