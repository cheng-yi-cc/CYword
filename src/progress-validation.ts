import type { AppProgress } from "./types.ts";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && value.length <= 32;
const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,150}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const ids = (value: unknown, limit = 10000): value is string[] => Array.isArray(value) && value.length <= limit && value.every(id);
const level = (value: unknown) => ["unmastered", "unclear", "mastered"].includes(String(value));
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;
const ratingVersion = (value: unknown) => value === undefined || (record(value) && Number.isSafeInteger(value.counter)
  && Number(value.counter) >= 1 && Number(value.counter) < Number.MAX_SAFE_INTEGER && id(value.actor));

export function validProgress(value: unknown): value is AppProgress {
  if (!record(value) || value.version !== 2 || !record(value.words) || !record(value.planDays) || !record(value.bookmarks) || !Array.isArray(value.reviewHistory)) return false;
  if (Object.keys(value.words).length > 10000 || Object.keys(value.planDays).length > 100 || Object.keys(value.bookmarks).length > 10000 || value.reviewHistory.length > 60000) return false;
  if (value.localSync !== undefined && (!record(value.localSync) || typeof value.localSync.restored !== "boolean" || typeof value.localSync.pending !== "boolean")) return false;
  for (const [key, word] of Object.entries(value.words)) {
    if (!id(key) || !record(word) || !stamp(word.learnedAt) || !stamp(word.lastSeenAt) || !level(word.proficiency) || !count(word.exposures) || !count(word.reviewCount)) return false;
    if (!ratingVersion(word.ratingVersion)) return false;
  }
  for (const [key, day] of Object.entries(value.planDays)) {
    if (!/^[1-9]\d?$/.test(key) || !record(day) || !["study", "review"].includes(String(day.kind)) || !stamp(day.startedAt) || (day.completedAt !== undefined && !stamp(day.completedAt)) || typeof day.skipMastered !== "boolean") return false;
    if (!ids(day.completedGroupIds) || !ids(day.ratedExposureKeys) || !ids(day.reviewWordIds) || !ids(day.reviewedWordIds)) return false;
    if (day.reviewRoundId !== undefined && !id(day.reviewRoundId)) return false;
    if (day.reviewSkippedWordIds !== undefined && !ids(day.reviewSkippedWordIds)) return false;
    if (day.emptyReviewConfirmed !== undefined && (typeof day.emptyReviewConfirmed !== "boolean" || day.reviewWordIds.length > 0)) return false;
    if (day.reviewPriority !== undefined && (!record(day.reviewPriority) || Object.keys(day.reviewPriority).length > 10000
      || !Object.entries(day.reviewPriority).every(([key, rank]) => id(key) && Number.isInteger(rank) && Number(rank) >= 0 && Number(rank) <= 2))) return false;
    const queue = new Set(day.reviewWordIds);
    if (!day.reviewedWordIds.every((wordId) => queue.has(wordId))) return false;
  }
  for (const [key, at] of Object.entries(value.bookmarks)) if (!id(key) || !stamp(at)) return false;
  if (value.bookmarkChanges !== undefined) {
    if (!record(value.bookmarkChanges) || Object.keys(value.bookmarkChanges).length > 10000) return false;
    for (const [key, change] of Object.entries(value.bookmarkChanges)) if (!id(key) || !record(change) || !stamp(change.at) || typeof change.saved !== "boolean") return false;
  }
  return value.reviewHistory.every((item) => record(item) && id(item.wordId) && stamp(item.date) && level(item.proficiency) && ratingVersion(item.ratingVersion) && (item.reviewRoundId === undefined || id(item.reviewRoundId)) && Number.isInteger(item.planDay) && Number(item.planDay) >= 1 && Number(item.planDay) <= 99);
}
