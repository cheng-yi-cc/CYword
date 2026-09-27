-- Incremental records are separate from the retained legacy compressed snapshots.
CREATE TABLE IF NOT EXISTS progress_heads_v2 (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  last_batch TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, book_code)
);
CREATE TABLE IF NOT EXISTS progress_records_v2 (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  record_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  revision INTEGER NOT NULL,
  first_day INTEGER NOT NULL DEFAULT 0,
  learned INTEGER NOT NULL DEFAULT 0 CHECK (learned IN (0,1)),
  reviews TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(reviews)),
  bucket TEXT NOT NULL,
  PRIMARY KEY (user_id, book_code, record_id)
);
CREATE INDEX IF NOT EXISTS progress_records_v2_changes ON progress_records_v2(user_id, book_code, revision, record_id);
CREATE TABLE IF NOT EXISTS progress_batches_v2 (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_code, batch_id)
);
CREATE TABLE IF NOT EXISTS progress_parts_v2 (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  digest TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_code, batch_id, part),
  FOREIGN KEY (user_id, book_code, batch_id) REFERENCES progress_batches_v2(user_id, book_code, batch_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS progress_staging_v2 (
  user_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  first_day INTEGER NOT NULL,
  learned INTEGER NOT NULL CHECK (learned IN (0,1)),
  reviews TEXT NOT NULL CHECK (json_valid(reviews)),
  bucket TEXT NOT NULL,
  PRIMARY KEY (user_id, book_code, batch_id, record_id),
  FOREIGN KEY (user_id, book_code, batch_id) REFERENCES progress_batches_v2(user_id, book_code, batch_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS progress_learning_stats_v2 (
  user_id TEXT NOT NULL, book_code TEXT NOT NULL, first_day INTEGER NOT NULL,
  marked INTEGER NOT NULL CHECK (marked >= 0),
  PRIMARY KEY (user_id, book_code, first_day)
);
CREATE TABLE IF NOT EXISTS progress_review_stats_v2 (
  user_id TEXT NOT NULL, book_code TEXT NOT NULL, day INTEGER NOT NULL,
  queued INTEGER NOT NULL CHECK (queued >= 0),
  reviewed INTEGER NOT NULL CHECK (reviewed >= 0),
  skipped INTEGER NOT NULL CHECK (skipped >= 0),
  PRIMARY KEY (user_id, book_code, day)
);
-- D1 constructs bounded JSON chunks directly from validated committed rows.
-- No Worker needs to deserialize the complete book to create a checkpoint.
CREATE TABLE IF NOT EXISTS progress_checkpoints_v2 (
  user_id TEXT NOT NULL, book_code TEXT NOT NULL, slot INTEGER NOT NULL,
  revision INTEGER NOT NULL, created_at INTEGER NOT NULL, bucket TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (user_id, book_code, slot, bucket)
);
CREATE TABLE IF NOT EXISTS progress_recovery_archive_v2 (
  archive_id TEXT NOT NULL, user_id TEXT NOT NULL, book_code TEXT NOT NULL,
  revision INTEGER NOT NULL, archived_at INTEGER NOT NULL, bucket TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (archive_id, bucket)
);
