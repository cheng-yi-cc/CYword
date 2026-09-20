import type { AppProgress } from "../../src/types.ts";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) && value.length <= 32;
const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,150}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const ids = (value: unknown, limit = 10000): value is string[] => Array.isArray(value) && value.length <= limit && value.every(id);
const level = (value: unknown) => ["unmastered", "unclear", "mastered"].includes(String(value));
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000;

export function validProgress(value: unknown): value is AppProgress {
  if (!record(value) || value.version !== 2 || !record(value.words) || !record(value.planDays) || !record(value.bookmarks) || !Array.isArray(value.reviewHistory)) return false;
  if (Object.keys(value.words).length > 10000 || Object.keys(value.planDays).length > 100 || Object.keys(value.bookmarks).length > 10000 || value.reviewHistory.length > 60000) return false;
  for (const [key, word] of Object.entries(value.words)) {
    if (!id(key) || !record(word) || !stamp(word.learnedAt) || !stamp(word.lastSeenAt) || !level(word.proficiency) || !count(word.exposures) || !count(word.reviewCount)) return false;
  }
  for (const [key, day] of Object.entries(value.planDays)) {
    if (!/^[1-9]\d?$/.test(key) || !record(day) || !["study", "review"].includes(String(day.kind)) || !stamp(day.startedAt) || (day.completedAt !== undefined && !stamp(day.completedAt)) || typeof day.skipMastered !== "boolean") return false;
    if (!ids(day.completedGroupIds) || !ids(day.ratedExposureKeys) || !ids(day.reviewWordIds) || !ids(day.reviewedWordIds)) return false;
    if (!day.reviewedWordIds.every((wordId) => (day.reviewWordIds as string[]).includes(wordId))) return false;
  }
  for (const [key, at] of Object.entries(value.bookmarks)) if (!id(key) || !stamp(at)) return false;
  if (value.bookmarkChanges !== undefined) {
    if (!record(value.bookmarkChanges) || Object.keys(value.bookmarkChanges).length > 10000) return false;
    for (const [key, change] of Object.entries(value.bookmarkChanges)) if (!id(key) || !record(change) || !stamp(change.at) || typeof change.saved !== "boolean") return false;
  }
  return value.reviewHistory.every((item) => record(item) && id(item.wordId) && stamp(item.date) && level(item.proficiency) && Number.isInteger(item.planDay) && Number(item.planDay) >= 1 && Number(item.planDay) <= 99);
}

export async function packProgress(progress: AppProgress): Promise<ArrayBuffer> {
  const raw = new TextEncoder().encode(JSON.stringify(progress));
  return new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

export async function unpackProgress(payload: ArrayBuffer | number[]): Promise<AppProgress> {
  const bytes = Array.isArray(payload) ? new Uint8Array(payload) : new Uint8Array(payload);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json<AppProgress>();
}
