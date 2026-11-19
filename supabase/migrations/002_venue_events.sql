-- JamSignal venue events
--
-- The second event source. Ticketmaster only lists venues that sell tickets
-- through it, and the rooms the jam scene plays frequently do not: measured for
-- Burlington VT, 50 miles, 180 days, Ticketmaster had eleven events for the
-- whole metro while one venue inside that radius listed seventy-one on its own
-- site. Even in Denver it has neither Twiddle nor TAUK at Cervantes.
--
-- Unlike artist_index, this is a cache rather than an index. Artist analysis is
-- expensive to compute and effectively permanent — a band's Last.fm
-- neighbourhood does not change between searches. A venue's calendar changes
-- constantly, so rows carry a TTL and the reader filters on it. Nothing here is
-- authoritative; it is a copy of what the venue published at ingestion time.
--
-- Populated by `npm run ingest` (scripts/ingest-venues.ts), never on the
-- request path: one feed fetch plus one page fetch per event, 114 for
-- Cervantes, with each host's crawl-delay honoured.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the SQL
-- editor. Idempotent.

create table if not exists venue_events (
  -- The event page URL. It is the venue's own stable identity for the show, so
  -- re-ingesting updates in place rather than duplicating. Trailing slashes are
  -- stripped before use — see src/lib/sources/venues/feed.ts.
  url           text        primary key,

  -- Registry key, not a free-text name: coordinates and display name live in
  -- src/lib/sources/venues/registry.ts so that a venue's details are versioned
  -- with the code rather than copied into every row.
  venue_key     text        not null,

  -- Billing as published, e.g. "Mihali Presents: MihaliDaze". The performer is
  -- derived from this at read time by the same normaliser the rest of the app
  -- uses, so improving that logic does not require re-ingesting.
  title         text        not null,

  -- Local date of the show, YYYY-MM-DD, taken from the published UTC offset.
  -- Stored as date rather than timestamptz deliberately: converting an 8pm
  -- show to UTC moves it to the next day for every venue west of Greenwich.
  event_date    date        not null,

  -- Local start time when the page states one; many listings omit it.
  start_time    time,

  -- Where to buy. Usually the venue's ticketing platform (Etix for Cervantes)
  -- rather than the venue itself.
  ticket_url    text,

  ingested_at   timestamptz not null default now()
);

-- Every read filters by venue and date window.
create index if not exists venue_events_venue_date_idx
  on venue_events (venue_key, event_date);

-- Supports the TTL filter and lets the ingestion report staleness per venue.
create index if not exists venue_events_ingested_at_idx
  on venue_events (ingested_at);

comment on table venue_events is
  'Cached venue calendars for rooms Ticketmaster does not carry. A copy of published listings, not an authority — rows expire and are re-ingested.';
