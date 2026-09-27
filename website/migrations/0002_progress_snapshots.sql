CREATE TABLE IF NOT EXISTS progress_snapshots (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  slot INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  payload BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_code, slot)
);

-- Exception recovery copies are explicit operator actions, not one copy per rating.
CREATE TABLE IF NOT EXISTS progress_recovery_archive (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload BLOB NOT NULL,
  archived_at INTEGER NOT NULL
);
