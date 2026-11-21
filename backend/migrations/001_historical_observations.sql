CREATE TABLE IF NOT EXISTS saferoute_historical_observations (
  record_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL CHECK (dataset_id IN ('weather_archive', 'discharge_estimate', 'cwc_river_observation')),
  record_type TEXT NOT NULL CHECK (record_type IN ('historical_weather_archive', 'historical_model_estimate', 'forecast_estimate', 'cwc_reported_discharge')),
  observed_at TEXT NOT NULL,
  observed_at_utc TIMESTAMPTZ,
  location_id INTEGER,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  measurements JSONB NOT NULL CHECK (jsonb_typeof(measurements) = 'object'),
  source_path TEXT NOT NULL,
  provenance TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS saferoute_historical_dataset_time_idx
  ON saferoute_historical_observations (dataset_id, observed_at_utc);

CREATE INDEX IF NOT EXISTS saferoute_historical_location_idx
  ON saferoute_historical_observations (dataset_id, location_id, observed_at);

CREATE TABLE IF NOT EXISTS saferoute_historical_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('earthquake', 'forest_fire')),
  event_date DATE,
  occurred_at_utc TIMESTAMPTZ,
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  location_text TEXT,
  details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  source_path TEXT NOT NULL,
  provenance TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS saferoute_historical_events_type_date_idx
  ON saferoute_historical_events (event_type, event_date);

CREATE INDEX IF NOT EXISTS saferoute_historical_events_coordinates_idx
  ON saferoute_historical_events (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
