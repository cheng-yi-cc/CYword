CREATE TABLE IF NOT EXISTS learning_progress (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_code)
);
