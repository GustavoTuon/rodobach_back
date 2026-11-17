CREATE TABLE IF NOT EXISTS itinerary_extra_catalog (
  id BIGSERIAL PRIMARY KEY,
  description VARCHAR(200) NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
