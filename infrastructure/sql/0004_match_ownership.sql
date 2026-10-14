ALTER TABLE matches ADD COLUMN creator_id UUID REFERENCES players(id) ON DELETE SET NULL;

UPDATE matches m SET creator_id = mp.player_id
FROM match_players mp
WHERE mp.match_id = m.id AND mp.colour = 'blue';

CREATE INDEX matches_creator_idx ON matches (creator_id);
