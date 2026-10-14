CREATE TABLE match_commands (
  match_id TEXT NOT NULL,
  command_id UUID NOT NULL,
  player_id TEXT NOT NULL,
  command JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, command_id)
);

CREATE TABLE match_scheduled_events (
  match_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('building_ready', 'unit_ready')),
  due_at_ms DOUBLE PRECISION NOT NULL,
  applied_at_ms DOUBLE PRECISION,
  PRIMARY KEY (match_id, event_id)
);

CREATE INDEX match_scheduled_events_pending_idx
  ON match_scheduled_events (match_id, due_at_ms)
  WHERE applied_at_ms IS NULL;
