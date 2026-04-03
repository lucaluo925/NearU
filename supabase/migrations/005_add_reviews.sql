-- User reviews for items (places, events, etc.)
CREATE TABLE IF NOT EXISTS reviews (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid         NOT NULL,
  user_id    text         NOT NULL,
  rating     smallint     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment    text,
  created_at timestamptz  NOT NULL DEFAULT now(),
  -- One review per user per item; updates existing on conflict
  UNIQUE (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_item_id  ON reviews(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id  ON reviews(user_id);
