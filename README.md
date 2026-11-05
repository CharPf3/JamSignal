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
                       additive evidence score, 0–10
```

Jam bands don't change between searches, so analysing them on the request path
is the wrong place for the work. Search joins against the index; only artists
never seen before are analysed inline, under a budget.

## Scoring

Signals were chosen by measuring each one's ability to separate 30 known jam
acts from 25 country/folk/blues acts that surface in the same searches. AUC is
the probability a random jam act outranks a random non-jam act — 0.5 is a coin
flip.

| Signal | AUC | Role |
| --- | --- | --- |
| Last.fm rank-weighted jam tags | **0.957** | primary, up to 5.0 pts |
| Last.fm similar-artist affinity | **0.923** | up to 2.5 pts |
| setlist.fm jam covers per show | 0.811 | up to 1.5 pts |
| MusicBrainz jam disambiguation | — | up to 1.5 pts |
| Ticketmaster genre classification | 0.611 | **not used** |
| setlist.fm songs per show | 0.318 | **not used** (anti-correlated) |

Three findings shaped the model:

- **Ticketmaster can't rank.** Its most common classification for jam acts *and*
  non-jam acts alike is `Rock/Pop`. The genre has no home in that taxonomy, so
  Ticketmaster is used only to find out who is playing.
- **The jammiest bands cover least.** Trey Anastasio averages 17.07 jam covers
  per show; the Disco Biscuits average 0.00. Both are jam bands. Cover evidence
  is therefore a bonus and never a gate — and every signal except Last.fm tags
  is positive-only for the same class of reason.
- **Entity resolution is the bottleneck, not scoring.** Setlist.fm's own artist
  search resolved "Goose" to "8track Gorilla & Freedom Goose" and "Eggy" to an
  unrelated solo artist, each returning 404. Going through MusicBrainz first
  yields 824 and 747 setlists.

Every weight lives in [`src/lib/scoring/weights.ts`](src/lib/scoring/weights.ts)
with the reasoning beside it. The model is validated against committed fixtures
of real API responses:

```bash
npm test              # 14 assertions, incl. AUC ≥ 0.9 on the labelled set
npm run test:scores   # prints the full ranked table
```

Current: **AUC 0.993**, 27/30 jam acts surfaced, 0/25 false positives.

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
    scoring/               the evidence model and its weights
tests/                     scoring validation + committed API fixtures
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm test` | scoring model validation |
| `npm run test:scores` | print the ranked labelled set |
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
