-- ============================================================
-- JamSignal — Initial Schema
-- ============================================================

-- Reusable trigger function: keep updated_at current
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Bands
-- Permanently cached band analysis. Only updated when
-- a band is re-analyzed (new data or confidence is stale).
-- ------------------------------------------------------------
CREATE TABLE bands (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  confidence_score    NUMERIC(3,1) CHECK (confidence_score BETWEEN 0 AND 10),
  ai_explanation      TEXT,
  genre_tags          TEXT[] DEFAULT '{}',
  setlist_gd_songs    TEXT[] DEFAULT '{}',  -- GD songs detected in recent sets
  setlist_gd_count    INT DEFAULT 0,
  spotify_id          TEXT,
  bandsintown_id      TEXT,
  last_analyzed_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER bands_updated_at
  BEFORE UPDATE ON bands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_bands_slug ON bands (slug);
CREATE INDEX idx_bands_confidence ON bands (confidence_score DESC NULLS LAST);

-- ------------------------------------------------------------
-- Venues
-- Venue intelligence. Jam-friendly venues boost unknown bands.
-- ------------------------------------------------------------
CREATE TABLE venues (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT,
  country             TEXT NOT NULL DEFAULT 'US',
  latitude            NUMERIC(9,6),
  longitude           NUMERIC(9,6),
  is_jam_friendly     BOOLEAN NOT NULL DEFAULT FALSE,
  jam_friendly_score  NUMERIC(3,1) CHECK (jam_friendly_score BETWEEN 0 AND 10),
  ticketmaster_id     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_venues_location ON venues (city, state);
CREATE INDEX idx_venues_jam_friendly ON venues (is_jam_friendly) WHERE is_jam_friendly = TRUE;

-- ------------------------------------------------------------
-- Recurring Nights
-- Weekly Jerry nights, monthly Dead jams, etc.
-- Tracked separately from one-off events.
-- ------------------------------------------------------------
CREATE TABLE recurring_nights (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun, 6=Sat
  frequency   TEXT NOT NULL DEFAULT 'weekly'
                CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_nights_venue ON recurring_nights (venue_id);
CREATE INDEX idx_recurring_nights_active ON recurring_nights (is_active) WHERE is_active = TRUE;

-- ------------------------------------------------------------
-- Subscriptions
-- Email alert subscriptions for nearby shows.
-- unsubscribe_token enables one-click unsubscribe without auth.
-- ------------------------------------------------------------
CREATE TABLE subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  city               TEXT,
  state              TEXT,
  latitude           NUMERIC(9,6),
  longitude          NUMERIC(9,6),
  radius_miles       INT NOT NULL DEFAULT 50 CHECK (radius_miles BETWEEN 10 AND 500),
  min_confidence     NUMERIC(3,1) NOT NULL DEFAULT 6.0 CHECK (min_confidence BETWEEN 0 AND 10),
  frequency          TEXT NOT NULL DEFAULT 'weekly'
                       CHECK (frequency IN ('weekly', 'immediate')),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  unsubscribe_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_subscriptions_email ON subscriptions (email) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_subscriptions_unsubscribe_token ON subscriptions (unsubscribe_token);

-- ------------------------------------------------------------
-- Community Submissions
-- User-submitted shows (the Facebook/Instagram problem).
-- Approved submissions surface in event results.
-- ------------------------------------------------------------
CREATE TABLE community_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_name           TEXT NOT NULL,
  venue_name          TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT,
  event_date          DATE NOT NULL,
  event_url           TEXT,
  submitted_by_email  TEXT,
  notes               TEXT,
  is_approved         BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_community_submissions_date ON community_submissions (event_date);
CREATE INDEX idx_community_submissions_approved ON community_submissions (is_approved) WHERE is_approved = TRUE;
