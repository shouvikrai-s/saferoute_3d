ALTER TABLE saferoute_historical_observations
  DROP CONSTRAINT IF EXISTS saferoute_historical_observations_dataset_id_check;

ALTER TABLE saferoute_historical_observations
  ADD CONSTRAINT saferoute_historical_observations_dataset_id_check
  CHECK (dataset_id IN ('weather_archive', 'discharge_estimate', 'cwc_river_observation'));

ALTER TABLE saferoute_historical_observations
  DROP CONSTRAINT IF EXISTS saferoute_historical_observations_record_type_check;

ALTER TABLE saferoute_historical_observations
  ADD CONSTRAINT saferoute_historical_observations_record_type_check
  CHECK (record_type IN (
    'historical_weather_archive',
    'historical_model_estimate',
    'forecast_estimate',
    'cwc_reported_discharge'
  ));

CREATE INDEX IF NOT EXISTS saferoute_cwc_station_time_idx
  ON saferoute_historical_observations (location_id, observed_at_utc DESC)
  WHERE dataset_id = 'cwc_river_observation';
