# JamSignal

Finds jam bands, Grateful Dead tributes and improvisational acts playing near
you, scores each artist on measurable evidence, and shows its reasoning.

**Live:** [jam-signal.vercel.app](https://jam-signal.vercel.app)

---

## How it works

Search is two-stage — candidate generation, then ranking — with artist analysis
precomputed rather than done per request.

```
REQUEST PATH  (no music-API calls when the index is warm)
  location ──▶ geocode ──▶ Ticketmaster: who is playing nearby
                              │  throttled · retried · deduped
                              ▼
                        join the artist index ──▶ group by artist ──▶ rank

ANALYSIS  (per artist, once, then cached 30 days)
  name ──▶ MusicBrainz: resolve to an MBID
             ├─▶ Last.fm (by name): genre tags + similar artists
             └─▶ setlist.fm (by MBID): cover attribution + canon songs
                              ▼
                   learned logistic model -> score 0–10
```

Jam bands don't change between searches, so analysing them on the request path
is the wrong place for the work. Search joins against the index; only artists
never seen before are analysed inline, under a budget.

## Scoring

A logistic model whose weights are **learned from a labelled set of 441
artists**, not hand-assigned. Positives are curated jam acts; negatives are the
real Ticketmaster candidate pool harvested across ten cities — the distribution
the model actually faces. Contested acts are labelled `borderline` and excluded
from fitting rather than forced to a side.

Held out over 25 stratified splits:

| | precision | recall |
| --- | --- | --- |
| **shipped model** | **92.1% ± 4.5** | **94.2% ± 2.9** |
| previous hand-tuned model | 98.4% ± 1.8 | 77.7% ± 5.3 |

Three feature families, and the ablation that justifies each:

| features | recall |
| --- | --- |
| Last.fm tags alone | 73.0% |
| similarity graph alone | 87.6% |
| tags + graph | 89.9% |
| + cover-attribution override | **94.2%** |

**Tags describe surface genre; the scene is defined by adjacency.** TAUK is
tagged `jazz, fusion` exactly like fifty non-jam jazz acts, but sits beside
Lettuce and Dopapod in Last.fm's similarity graph. The graph feature measures
how much of an artist's neighbourhood falls inside a precomputed jam-affinity
table, which is what lets the model generalise to bands nobody has listed.

**Cover attribution is a rule, not a feature.** A band playing most of a
Grateful Dead set nightly is a Dead act whatever Last.fm says — Cubensis
averages 8.45 attributed Dead covers per show while Last.fm files it under
thrash metal. On the labelled set every artist above the threshold was a jam act
(30/30), so the rule fires above 0.75 covers per show with a 0.90 probability
floor, the Wilson lower bound on 30/30. Letting the model learn this from the
feature instead was tested first and scored slightly worse (−0.95 pts).

### Two methodological mistakes worth not repeating

**AUC hid a calibration failure.** An earlier model weighted each tag by its
share of the artist's top tag. That buried the Grateful Dead at 3.7/10 — their
`Jam` tag has count 10 against `Psychedelic Rock` at 100 — along with Gov't
Mule, Billy Strings and Tedeschi Trucks. All four tag formulations scored
AUC 0.950, because AUC is threshold-free and they rank identically; their recall
at the cut that actually ships ranged from 73% to 97%. **Evaluate at the
operating point you ship.**

**The assumption was backwards.** Testing it showed zero non-jam acts carried a
jam tag at *any* count while almost every jam act did. Presence is nearly
conclusive; rank is close to irrelevant, because Last.fm tag counts are
dominated by whichever generic genre also applies.

### Reproducing

```bash
npm run fit          # refit from the fixture, rewrite the artifacts, print metrics
npm run fit -- --dry-run
npm test             # 20 assertions against the labelled set
```

Inputs and outputs are committed, so scoring is reproducible and reviewable and
the app carries no training-time dependency:

| file | what it is |
| --- | --- |
| `tests/fixtures/labelled-artists.json` | 471 artists, verbatim API responses |
| `tests/fixtures/label-decisions.json` | every label correction, with its justification |
| `src/lib/scoring/model.generated.json` | learned weights, threshold, override |
| `src/lib/scoring/affinity.generated.json` | jam-affinity table, 2,379 artists |

Ticketmaster is still excluded from scoring entirely: measured AUC 0.611,
because its most common classification for jam acts *and* non-jam acts alike is
`Rock/Pop`. It finds who is playing; it does not rank.

## Setup

```bash
git clone https://github.com/CharPf3/JamSignal.git
cd JamSignal
npm install
cp .env.example .env.local   # then fill in the keys below
npm run dev
```

### Keys

| Variable | Needed for | Free? |
| --- | --- | --- |
| `TICKETMASTER_API_KEY` | finding events — nothing works without it | yes, [developer.ticketmaster.com](https://developer.ticketmaster.com) |
| `LASTFM_API_KEY` | the primary scoring signal | yes, [last.fm/api](https://www.last.fm/api/account/create) |
| `SETLISTFM_API_KEY` | cover attribution and setlists | yes, [setlist.fm/settings/api](https://www.setlist.fm/settings/api) |
| `NEXT_PUBLIC_SUPABASE_URL` | the artist index | yes, [supabase.com](https://supabase.com) |
| `SUPABASE_SERVICE_ROLE_KEY` | the artist index | — |

MusicBrainz and Nominatim need no key, only a descriptive `User-Agent` (set in
`src/lib/core/env.ts`).

The app degrades rather than crashes when a key is missing, and the search
response reports what is unconfigured in `diagnostics.missing_config`.

### Database

Apply [`supabase/migrations/001_artist_index.sql`](supabase/migrations/001_artist_index.sql)
via `supabase db push` or the SQL editor. Without it the app still works, but
every search re-analyses every artist from scratch.

> **Note:** free-tier Supabase projects are paused when idle and eventually
> deleted. That is how the previous index was lost — its host stopped resolving
> and every cache read failed silently. Keep the project warm or expect to
> recreate it.

## Layout

```
src/
  app/                     routes — thin, all logic lives in lib/
    api/events/            search as JSON
    api/locations/         geocoding + autocomplete
    api/debug/search/      same pipeline, verbose output
  components/
    search/                location autocomplete, controls
    results/               artist cards, coverage notes
    score/                 score meter, signal breakdown
  lib/
    pipeline.ts            the one search pipeline
    core/                  rate limiting, retry, HTTP, env
    canon/                 known acts, canon songs, name normalisation
    sources/               musicbrainz · lastfm · setlistfm · ticketmaster · geocoding
    artists/               the artist index and its persistence
    scoring/               the learned model and its generated artifacts
tests/                     scoring validation + committed API fixtures
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | scoring model validation (20 assertions) |
| `npm run fit` | refit the model from the fixture and rewrite its artifacts |
| `npm run backfill -- --acts` | warm the artist index |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Debugging

```bash
# full pipeline output, including artists that were filtered out and why
curl 'localhost:3000/api/debug/search?location=Madison,WI&radius=50' | jq

# one artist, end to end
curl 'localhost:3000/api/debug/search?artist=Armchair+Boogie' | jq
```

## Attribution

Event data from Ticketmaster. Genre and similarity data from Last.fm. Setlists
from [setlist.fm](https://www.setlist.fm), whose attribution link is shown with
any artist where setlist data contributed. Artist identity from MusicBrainz.
Geocoding by Nominatim / OpenStreetMap.

## Licence

MIT — see [LICENSE](LICENSE).
