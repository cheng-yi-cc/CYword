import { buildPlan } from '../../src/progress.ts';
import { validProgress } from '../../src/progress-validation.ts';
import type { DayRecord, ProgressRecord, WordRecord } from '../../src/progress-records.ts';
import { progressCatalog, progressProtocol } from './progress-curriculum.ts';

export const incrementalProtocol = { ...progressProtocol, protocol: 2 };
export const plans = buildPlan(progressCatalog);
export const reviews = plans.filter(day => day.kind === 'review');
const byDay = new Map(plans.map(day => [day.day, day]));
const words = new Map<string, { firstDay: number; exposures: Map<number, Set<string>> }>();
for (const day of plans) if (day.kind === 'study') for (const key of day.exposureKeys ?? []) {
  const id = key.slice(key.lastIndexOf(':') + 1);
  let word = words.get(id);
  if (!word) { word = { firstDay: day.day, exposures: new Map() }; words.set(id, word); }
  if (!word.exposures.has(day.day)) word.exposures.set(day.day, new Set());
  word.exposures.get(day.day)!.add(key);
}
export const maximumRecords = words.size + plans.length;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const base = () => ({ version: 2, words: {}, planDays: {}, bookmarks: {}, reviewHistory: [] });
export class IncrementalInputError extends Error {}
const invalid = (): never => { throw new IncrementalInputError('增量学习记录无效'); };
export type StoredRecord = { record_id: string; value: string; first_day: number; learned: number; reviews: string; bucket: string };

/** Only bounded per-record checks run on the Worker; cross-record prerequisites
 * are validated against transactional database counters during commit. */
export function validateIncrementalRecord(input: unknown): StoredRecord {
  if (!object(input) || typeof input.id !== 'string' || !object(input.value)) return invalid();
  if (JSON.stringify(input).length > 16000) return invalid();
  const id: string = input.id, value = input.value;
  if (id.startsWith('d/')) {
    if (!/^d\/\d{2}$/.test(id)) return invalid();
    const number = Number(id.slice(2)), plan = byDay.get(number);
    if (!plan || value.kind !== plan.kind) return invalid();
    const marker: DayRecord = { kind: plan.kind, startedAt: value.startedAt, skipMastered: value.skipMastered };
    if (value.completedAt !== undefined) marker.completedAt = value.completedAt;
    if (plan.kind === 'study') {
      if (!Array.isArray(value.completedGroupIds) || new Set(value.completedGroupIds).size !== value.completedGroupIds.length
        || value.completedGroupIds.some((key: string) => !plan.groupIds.includes(key))) return invalid();
      marker.completedGroupIds = [...value.completedGroupIds].sort();
    } else {
      if (value.reviewRoundId !== plan.reviewRoundId) return invalid();
      marker.reviewRoundId = plan.reviewRoundId;
      if (value.emptyReviewConfirmed !== undefined) marker.emptyReviewConfirmed = value.emptyReviewConfirmed;
    }
    if (!validProgress({ ...base(), planDays: { [number]: { ...marker, completedGroupIds: marker.completedGroupIds ?? [], ratedExposureKeys: [], reviewWordIds: [], reviewedWordIds: [] } } })) return invalid();
    return { record_id: id, value: JSON.stringify(marker), first_day: 0, learned: 0, reviews: '{}', bucket: 'meta' };
  }
  const wordId = id.slice(2), known = id.startsWith('w/') ? words.get(wordId) : undefined;
  if (!known || !object(value.exposures) || !object(value.reviews) || Object.keys(value.exposures).length > 30 || Object.keys(value.reviews).length > 10) return invalid();
  const clean: WordRecord = { exposures: {}, reviews: {} };
  if (value.word !== undefined) {
    if (!validProgress({ ...base(), words: { [wordId]: value.word } })) return invalid();
    const word = value.word;
    clean.word = { learnedAt: word.learnedAt, lastSeenAt: word.lastSeenAt, proficiency: word.proficiency, exposures: 0, reviewCount: 0,
      ...(word.ratingVersion ? { ratingVersion: { counter: word.ratingVersion.counter, actor: word.ratingVersion.actor } } : {}) };
  }
  for (const [day, keys] of Object.entries(value.exposures)) {
    const allowed = known.exposures.get(Number(day));
    if (String(Number(day)) !== day || !allowed || !Array.isArray(keys) || keys.length > allowed.size || new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key))) return invalid();
    clean.exposures[day] = [...keys].sort();
    if (!clean.word) return invalid();
    clean.word.exposures += keys.length;
  }
  const stats: Record<string, { queued: number; reviewed: number; skipped: number }> = {};
  for (const [day, member] of Object.entries(value.reviews)) {
    const plan = byDay.get(Number(day));
    if (String(Number(day)) !== day || !plan || plan.kind !== 'review' || known.firstDay >= plan.day || !object(member) || typeof member.queued !== 'boolean' || !clean.word) return invalid();
    const next: WordRecord['reviews'][string] = { queued: member.queued };
    if (member.queued) {
      if (!Number.isInteger(member.priority) || member.priority < 0 || member.priority > 2) return invalid();
      next.priority = member.priority;
      if (member.rating !== undefined) {
        if (!object(member.rating)) return invalid();
        const rating = member.rating;
        if (!validProgress({ ...base(), reviewHistory: [{ ...rating, wordId, planDay: plan.day, reviewRoundId: plan.reviewRoundId }] })) return invalid();
        next.rating = { date: rating.date, proficiency: rating.proficiency,
          ...(rating.ratingVersion ? { ratingVersion: { counter: rating.ratingVersion.counter, actor: rating.ratingVersion.actor } } : {}) };
        clean.word.reviewCount++;
      }
    } else if (member.rating !== undefined || member.priority !== undefined) return invalid();
    clean.reviews[day] = next;
    stats[day] = { queued: member.queued ? 1 : 0, reviewed: next.rating ? 1 : 0, skipped: member.queued ? 0 : 1 };
  }
  if (value.bookmark !== undefined) {
    if (!validProgress({ ...base(), bookmarkChanges: { [wordId]: value.bookmark } })) return invalid();
    clean.bookmark = { at: value.bookmark.at, saved: value.bookmark.saved };
  }
  if (!clean.word && !clean.bookmark) return invalid();
  return { record_id: id, value: JSON.stringify(clean), first_day: known.firstDay, learned: clean.word ? 1 : 0, reviews: JSON.stringify(stats), bucket: wordId.slice(0, 2) };
}

export function wireRecord(row: { record_id: string; value: string }): ProgressRecord | { id: string; value: null; deleted: true } {
  if (row.value === 'null') return { id: row.record_id, value: null, deleted: true };
  return { id: row.record_id, value: JSON.parse(row.value) };
}
