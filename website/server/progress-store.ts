import { canonicalProgress } from "../../src/progress-business.ts";
import { mergeProgress } from "../../src/sync-merge.ts";
import { emptyProgress } from "../../src/progress.ts";
import { progressCatalog, progressProtocol } from "./progress-curriculum.ts";
import { packProgress, unpackProgress } from "./progress-sync.ts";
import type { AppProgress } from "../../src/types.ts";

type Row = { revision: number; payload: number[] };
const book = progressProtocol.bookCode;
export async function readStoredProgress(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT revision, payload FROM learning_progress WHERE user_id = ? AND book_code = ?").bind(userId, book).first<Row>();
  if (!row) return { revision: 0, progress: emptyProgress() };
  const raw = await unpackProgress(row.payload);
  if (raw.localSync !== undefined) throw new Error("Stored device metadata is invalid");
  return { revision: row.revision, progress: canonicalProgress(raw, progressCatalog) };
}

export async function saveStoredProgress(db: D1Database, userId: string, revision: number, input: AppProgress) {
  const current = await readStoredProgress(db, userId);
  if (current.revision !== revision) return { status: 409, ...current };
  const progress = canonicalProgress(mergeProgress(current.progress, input), progressCatalog);
  if (revision > 0 && JSON.stringify(progress) === JSON.stringify(current.progress)) return { status: 200, ...current };
  const packed = await packProgress(progress);
  if (packed.byteLength > 1_800_000) throw new RangeError("学习记录过大，已保留原记录");
  const now = Date.now(), slot = Math.floor(now / 3_600_000);
  const backup = (expected: number) => db.prepare(`INSERT INTO progress_snapshots (user_id, book_code, slot, revision, payload, created_at)
    SELECT user_id, book_code, ?, revision, payload, ? FROM learning_progress
    WHERE user_id = ? AND book_code = ? AND revision = ?
    ON CONFLICT(user_id, book_code, slot) DO NOTHING`).bind(slot, now, userId, book, expected);
  const write = revision === 0
    ? db.prepare("INSERT INTO learning_progress (user_id, book_code, revision, payload, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id, book_code) DO NOTHING").bind(userId, book, packed, now)
    : db.prepare("UPDATE learning_progress SET revision = revision + 1, payload = ?, updated_at = ? WHERE user_id = ? AND book_code = ? AND revision = ?").bind(packed, now, userId, book, revision);
  // A D1 batch is one transaction. Both copies use the revision predicate, so a
  // concurrent write cannot create a backup for the wrong acknowledged revision.
  const results = await db.batch([
    backup(revision), write, backup(revision + 1),
    db.prepare(`DELETE FROM progress_snapshots WHERE user_id = ? AND book_code = ? AND
      (created_at < ? OR slot NOT IN (SELECT slot FROM progress_snapshots WHERE user_id = ? AND book_code = ? ORDER BY slot DESC LIMIT 24))`)
      .bind(userId, book, now - 7 * 86_400_000, userId, book),
  ]);
  if (!results[1].meta.changes) return { status: 409, ...await readStoredProgress(db, userId) };
  return { status: 200, revision: revision + 1, progress };
}

/** Operator-only recovery: one explicit account and snapshot, guarded by revision.
 * Never exposed through the public progress API. The overwritten bytes are retained. */
export async function restoreAccountSnapshot(db: D1Database, userId: string, slot: number, expectedRevision: number) {
  if (!userId || !Number.isSafeInteger(slot) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("恢复参数无效");
  const source = await db.prepare("SELECT revision, payload FROM progress_snapshots WHERE user_id = ? AND book_code = ? AND slot = ?").bind(userId, book, slot).first<Row>();
  if (!source) throw new Error("未找到该账号的恢复快照");
  const restored = canonicalProgress(await unpackProgress(source.payload), progressCatalog);
  const current = await db.prepare("SELECT revision, payload FROM learning_progress WHERE user_id = ? AND book_code = ?").bind(userId, book).first<Row>();
  if (!current || current.revision !== expectedRevision) throw new Error("恢复期间进度已改变，请重新核对");
  let known: AppProgress | undefined;
  try { known = canonicalProgress(await unpackProgress(current.payload), progressCatalog); } catch { /* preserved byte-for-byte below */ }
  const actor = `recovery-${crypto.randomUUID()}`;
  for (const [id, word] of Object.entries(restored.words)) {
    word.ratingVersion = { actor, counter: Math.max(word.ratingVersion?.counter ?? 0, known?.words[id]?.ratingVersion?.counter ?? 0) + 1 };
  }
  const packed = await packProgress(restored), archiveId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT INTO progress_recovery_archive (id, user_id, book_code, revision, payload, archived_at)
      SELECT ?, user_id, book_code, revision, payload, ? FROM learning_progress WHERE user_id = ? AND book_code = ? AND revision = ?`)
      .bind(archiveId, Date.now(), userId, book, expectedRevision),
    db.prepare("UPDATE learning_progress SET revision = revision + 1, payload = ?, updated_at = ? WHERE user_id = ? AND book_code = ? AND revision = ?")
      .bind(packed, Date.now(), userId, book, expectedRevision),
  ]);
  if (!results[1].meta.changes) throw new Error("恢复期间进度已改变，未覆盖其他写入");
  return { archiveId, revision: expectedRevision + 1, progress: restored };
}
