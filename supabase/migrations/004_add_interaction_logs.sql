-- Tracks user interactions (views + favorites) for popularity ranking
CREATE TABLE IF NOT EXISTS interaction_logs (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text,
  item_id    uuid         NOT NULL,
  type       text         NOT NULL CHECK (type IN ('view', 'favorite')),
  created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interaction_item_type  ON interaction_logs(item_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_created_at ON interaction_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_type_date  ON interaction_logs(type, created_at DESC);
