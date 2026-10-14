ALTER TABLE match_scheduled_events
  DROP CONSTRAINT match_scheduled_events_kind_check;

ALTER TABLE match_scheduled_events
  ADD CONSTRAINT match_scheduled_events_kind_check
  CHECK (kind IN ('building_ready', 'unit_ready', 'respawn', 'protection_end'));
