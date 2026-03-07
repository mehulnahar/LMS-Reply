-- 013_counter_moves_unique.sql
-- Add unique constraint on counter_move_name to prevent duplicate rows
-- and enable ON CONFLICT DO UPDATE in the seeder

-- First, remove any existing duplicates (keep lowest id)
DELETE FROM counter_moves
WHERE id NOT IN (
  SELECT MIN(id) FROM counter_moves GROUP BY counter_move_name
);

-- Then add the unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_moves_name
ON counter_moves (counter_move_name);
