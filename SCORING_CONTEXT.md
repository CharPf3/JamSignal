# JamSignal — Scoring System Context

Use this document to start a new chat focused on tuning the scoring/weighting system.

---

## What JamSignal Is

A web app that finds local jam band / Grateful Dead-adjacent shows near you. User enters a city and radius; the app fetches events from Ticketmaster, enriches each band with genre and setlist data, scores them 0–10, and returns only the relevant ones. Built in Next.js 15 App Router, TypeScript strict mode, Tailwind, Supabase.

---

## Data Pipeline (How It Works)

For each unique band in the Ticketmaster results:

1. **Cache check** — Supabase `band_cache` table (30-day TTL). Cache hit → skip APIs entirely.
2. **Last.fm** `artist.gettoptags` — returns user-contributed genre tags (e.g. "jam band", "bluegrass", "psychedelic rock"). Replaced Spotify, which removed genre data from dev-tier apps in Nov 2024.
3. **Ticketmaster genre classification** — every TM event comes with `segment/genre/subGenre` taxonomy already in the response (no extra call). e.g. "Folk / Indie Folk", "Rock / Alternative Rock".
4. **Setlist.fm** (selective) — fetches 15 recent setlists, scans for songs from the jam canon (GD, Phish, Widespread Panic, Allman Brothers, Gov't Mule, etc.). Only called when warranted by score. Capped at 15 calls per search (Tier 1 bands bypass cap).
5. **Cache write** — only written when at least one source returned real data.

---

## Scoring System

### Two Paths

**Tier 1 bands** (exact keyword match against a hardcoded list of ~50 known jam acts):
- Baseline score: **7.0**
- Setlist bonus: up to +2.5 (based on jam_song_count, max 5 songs counted)
- High-signal bonus: up to +0.5 (songs like Dark Star, Reba, YEM — rarer, more improvisational)
- Hard cap: 10.0

**Discovery bands** (everything else):
```
raw = setlistScore * 0.45 + highSignalScore * 0.25 + genreScore * 0.30
confidence_score = min(raw, 8.5)
```
- `setlistScore` = (min(jam_song_count, 10) / 10) × 10
- `highSignalScore` = min(high_signal_count × 2, 10)
- `genreScore` = max(lastfmScore, tmGenreScore) — takes whichever source is stronger

**Display threshold: 2.5** — anything below is filtered out.

### Last.fm Tag Weights (in `src/lib/lastfm/client.ts`)

Direct jam signals (one tag = high confidence):
- `jam band`, `jam rock`, `jamgrass`, `jambands` → **10**
- `improvisational`, `newgrass` → **8**
- `electronic jam`, `jam-funk` → **7**
- `jam` → **6**
- `psychedelic rock` → **7**, `psychedelia`, `neo-psychedelic`, `acid rock` → **6**

Adjacent genre signals (stacking these helps but can't dominate alone):
- `bluegrass`, `americana`, `new americana`, `folk rock` → **3**
- `southern rock`, `roots rock`, `progressive rock`, `country rock`, `outlaw country` → **2**

Weak signals (only meaningful with other evidence):
- `funk`, `blues rock`, `blues`, `soul`, `indie folk` → **1**

All additive, capped at 10.

### TM Genre Fallback (in `src/lib/scoring/index.ts`)

Used when Last.fm has no data. Scores top out at 5 (deliberately lower than Last.fm):
- Folk, Americana → 4; Blues, Country → 3; Rock, Alternative, Jazz → 2
- Subgenre match gets +1 (e.g. "Indie Folk" sub-matches "folk" → 5)

### `should_run_setlist` Gate

Setlist.fm only called when:
- Tier 1 band, OR
- genreScore >= 4 (real genre signal), OR
- Last.fm returned `found: false` (local/unsigned act — setlist is our only signal)

---

## Observed Scoring Issues (May 2026)

From Madison WI and San Francisco searches:

| Band | Score | Assessment |
|------|-------|------------|
| Phish | 10.0 | ✓ Correct |
| Widespread Panic | 7.0 | Too low — should be higher than Marcus King |
| Marcus King | 7.0 | Probably too high — blues/rock, not a jam band |
| Clay Street Unit | 5.7 | Slightly high but acceptable — plays GD covers repeatedly |
| Armchair Boogie | 3.9 | Too low — they have a "jam" Last.fm tag + play Dead covers |
| Chris Stapleton | ~3.0 | Should probably be filtered (country star, no jam evidence) |
| I'm With Her | ~3.0 | Should probably be filtered (folk trio) |
| Blackberry Smoke | 2.5 | Borderline correct — southern rock band, should appear but low |

**Root issue:** The Tier 1 keyword list drives the biggest score jumps. If a real jam band isn't in the keyword list, they score through the discovery path and may land lower than they deserve. If a non-jam act scores well on either Last.fm tags or TM genre + setlist covers, they can crack 3.0+.

**Madison 1st vs 2nd search discrepancy:** First search populates the cache as it runs (slow, fewer results visible). Second search hits cache for all bands (fast, full results). This is expected cache-fill behavior but may feel like a bug.

---

## Ideas for Improvement

### 1. Last.fm Related Artists Signal
`artist.getSimilar` returns a ranked list of similar artists with a match score. If an artist's top similar artists include known jam bands (Dead, Phish, Widespread, etc.), that's strong evidence. Could be used to:
- Boost discovery scores when similar artists are in Tier 1
- Gate Setlist.fm calls more accurately
- Potentially build a dynamic "extended Tier 1" list
Rate limit: counts against the same 5 req/sec bucket as `gettoptags` — would need to decide if it's worth the extra call.

### 2. Tier 1 Keyword List Expansion
Widespread Panic is scoring 7.0 (Tier 1 floor) which is correct — but Marcus King also hitting 7.0 suggests Marcus King is in the Tier 1 list or is scoring very high through the discovery path. Worth auditing who's in the Tier 1 list vs who should be.

### 3. Setlist High-Signal Song List
The `high_signal_count` (songs like Dark Star, Reba, YEM) adds up to +0.5 bonus but is weighted at 0.25 in the discovery formula. Could potentially weight this more — a band that covers Reba is a very specific signal.

### 4. Minimum Setlist Evidence for Display
Currently a band can score 3.0+ purely from genre tags. Requiring at least 1 jam song in setlists (or being Tier 1) before surfacing could clean up false positives like Chris Stapleton.

### 5. Score Separate Components for UI
Rather than one opaque number, expose the component scores (`genre_score`, `setlist_score`, `tier`) in the API response — useful for debugging and potentially for UI display.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/lastfm/client.ts` | Last.fm tag fetch + JAM_TAGS weight map |
| `src/lib/scoring/index.ts` | scoreBand() — all scoring logic, TM genre fallback |
| `src/lib/ticketmaster/keywords.ts` | Tier 1 keyword list |
| `src/lib/setlistfm/jam-songs.ts` | Jam canon song list |
| `src/lib/setlistfm/gd-songs.ts` | GD subset (for descriptions) |
| `src/app/api/events/route.ts` | Main pipeline — cache, Last.fm, Setlist.fm, score |
| `src/app/api/test-pipeline/route.ts` | Debug endpoint — full pipeline output for any location |
| `supabase/schema.sql` | band_cache table schema |

---

## Debug Endpoints

- `GET /api/test-pipeline?location=Madison,WI&radius=50` — full pipeline breakdown for any search, all bands with scores, split into passed/filtered arrays
- `GET /api/test-spotify?band=Armchair+Boogie` — Last.fm tag lookup for a single band
- `GET /api/test-setlist?band=Armchair+Boogie` — Setlist.fm analysis for a single band
