-- JamSignal artist index
--
-- Supersedes the earlier band_cache table and the three overlapping SQL files
-- that defined it (schema.sql, migrations/001_initial_schema.sql and
-- migrate_spotify_to_lastfm.sql, which renamed Spotify-era columns). Those
-- described tables the app never read and omitted the only one it did.
--
-- This is not a cache of API responses. It is the precomputed index that search
-- joins against: analysing artists on the request path is what made a 25-mile
-- search take 96 seconds. Analysis is stored as jsonb so the scoring model can
-- change without a migration — rows older than the TTL are simply re-analysed.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the SQL
-- editor. Idempotent.

create table if not exists artist_index (
  -- Normalised name: lowercased, accents and apostrophes stripped, leading
  -- article dropped. See src/lib/canon/normalize.ts — the app and this table
  -- must agree on the key, so it is always produced by normalizeName().
  artist_key   text        primary key,

  -- Display name, preferring MusicBrainz's spelling once resolved.
  artist_name  text        not null,

  -- MusicBrainz id. Null when no confident match exists, which is a real
  -- outcome: resolving nothing beats resolving the wrong artist.
  mbid         uuid,

  -- Score, label, per-signal contributions, reasons and setlist attribution.
  -- Shape: src/lib/artists/index.ts ArtistAnalysis.
  analysis     jsonb       not null,

  analyzed_at  timestamptz not null default now()
);

-- Lookups filter on freshness, and the backfill script walks oldest-first.
create index if not exists artist_index_analyzed_at_idx
  on artist_index (analyzed_at);

-- Supports ranked browsing and "what did we score highest" queries without a
-- full scan.
create index if not exists artist_index_score_idx
  on artist_index (((analysis -> 'score')::numeric) desc);

-- Resolved artists are looked up by MBID when joining across sources.
create index if not exists artist_index_mbid_idx
  on artist_index (mbid)
  where mbid is not null;

comment on table artist_index is
  'Precomputed jam-signal analysis per artist. Search joins against this rather than calling music APIs on the request path.';
