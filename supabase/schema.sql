-- JamSignal band cache table
-- Stores raw API data from Last.fm and Setlist.fm.
-- Scores are always computed live in code — this table just prevents repeat API calls.
-- 30-day TTL: algorithm changes redeploy cleanly, stale rows refresh on next lookup.

create table if not exists band_cache (
  id               uuid        primary key default gen_random_uuid(),
  artist_name      text        unique not null,

  -- Last.fm (genre/tag data)
  genre_tags           text[]  not null default '{}',
  jam_genre_score      integer not null default 0,
  matched_genre_tags   text[]  not null default '{}',
  genre_found          boolean not null default false,

  -- Setlist.fm (raw response data)
  setlist_mbid             text,
  jam_songs                text[]  not null default '{}',  -- full jam canon (GD + Phish + etc.)
  gd_songs                 text[]  not null default '{}',  -- Grateful Dead subset for descriptions
  jam_song_count           integer not null default 0,
  high_signal_count        integer not null default 0,
  setlists_analyzed        integer not null default 0,
  setlist_attribution_url  text,
  setlist_found            boolean not null default false,

  -- Cache metadata
  cached_at   timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days')
);

-- Efficient expiry sweeps (artist_name lookup covered by the unique constraint above)
create index if not exists band_cache_expires_at_idx on band_cache (expires_at);
