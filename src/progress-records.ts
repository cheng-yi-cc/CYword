import type { AppProgress, PlanDayProgress, WordProgress } from './types.ts';

export type RecordRating = Pick<AppProgress['reviewHistory'][number], 'date' | 'proficiency' | 'ratingVersion'>;
export interface WordRecord {
  word?: WordProgress;
  exposures: Record<string, string[]>;
  reviews: Record<string, { queued: boolean; priority?: number; rating?: RecordRating }>;
  bookmark?: { at: string; saved: boolean };
}
export type DayRecord = Pick<PlanDayProgress, 'kind' | 'startedAt' | 'completedAt' | 'skipMastered' | 'reviewRoundId' | 'emptyReviewConfirmed'> & { completedGroupIds?: string[] };
export type ProgressRecord = { id: string; value: WordRecord | DayRecord };

/** One bounded record per word, including all of that word's review events.
 * A rating changes a few records instead of resending every learner event. */
export function progressToRecords(progress: AppProgress): Map<string, ProgressRecord> {
  const records = new Map<string, ProgressRecord>();
  const wordRecord = (id: string): WordRecord => {
    const key = `w/${id}`;
    let record = records.get(key);
    if (!record) { record = { id: key, value: { exposures: {}, reviews: {} } }; records.set(key, record); }
    return record.value as WordRecord;
  };
  for (const [id, word] of Object.entries(progress.words)) wordRecord(id).word = structuredClone(word);
  for (const [dayNumber, day] of Object.entries(progress.planDays)) {
    const value: DayRecord = { kind: day.kind, startedAt: day.startedAt, skipMastered: day.skipMastered };
    if (day.completedAt) value.completedAt = day.completedAt;
    if (day.kind === 'study') {
      value.completedGroupIds = [...day.completedGroupIds].sort();
      for (const key of day.ratedExposureKeys) {
        const id = key.slice(key.lastIndexOf(':') + 1), record = wordRecord(id);
        (record.exposures[dayNumber] ??= []).push(key);
      }
    } else {
      value.reviewRoundId = day.reviewRoundId;
      if (day.emptyReviewConfirmed !== undefined) value.emptyReviewConfirmed = day.emptyReviewConfirmed;
      for (const id of day.reviewWordIds) wordRecord(id).reviews[dayNumber] = { queued: true, priority: day.reviewPriority?.[id] ?? 2 };
      for (const id of day.reviewSkippedWordIds ?? []) wordRecord(id).reviews[dayNumber] = { queued: false };
    }
    records.set(`d/${dayNumber.padStart(2, '0')}`, { id: `d/${dayNumber.padStart(2, '0')}`, value });
  }
  for (const item of progress.reviewHistory) {
    const record = wordRecord(item.wordId), member = record.reviews[String(item.planDay)];
    if (!member?.queued) throw new Error('复习记录缺少队列成员');
    member.rating = { date: item.date, proficiency: item.proficiency, ...(item.ratingVersion ? { ratingVersion: { ...item.ratingVersion } } : {}) };
  }
  const bookmarks = { ...Object.fromEntries(Object.entries(progress.bookmarks).map(([id, at]) => [id, { at, saved: true }])), ...progress.bookmarkChanges };
  for (const [id, value] of Object.entries(bookmarks)) wordRecord(id).bookmark = { ...value };
  for (const record of records.values()) if (record.id.startsWith('w/')) {
    for (const keys of Object.values((record.value as WordRecord).exposures)) keys.sort();
  }
  return new Map([...records].sort(([a], [b]) => a.localeCompare(b)));
}

/** The caller applies the normal production canonical/business validation after
 * collecting a complete read. Partial network pages must never become local state. */
export function recordsToProgress(records: Iterable<ProgressRecord>): AppProgress {
  const all = [...records], progress: AppProgress = { version: 2, words: {}, planDays: {}, bookmarks: {}, bookmarkChanges: {}, reviewHistory: [] };
  for (const record of all) if (record.id.startsWith('d/')) {
    const value = record.value as DayRecord;
    progress.planDays[String(Number(record.id.slice(2)))] = { ...structuredClone(value), completedGroupIds: value.completedGroupIds ?? [],
      ratedExposureKeys: [], reviewWordIds: [], reviewedWordIds: [], ...(value.kind === 'review' ? { reviewPriority: {}, reviewSkippedWordIds: [] } : {}) };
  }
  for (const record of all) if (record.id.startsWith('w/')) {
    const id = record.id.slice(2), value = record.value as WordRecord;
    if (value.word) progress.words[id] = structuredClone(value.word);
    for (const [key, exposures] of Object.entries(value.exposures)) {
      const day = progress.planDays[key];
      if (!day || day.kind !== 'study') throw new Error('增量进度缺少学习日');
      day.ratedExposureKeys.push(...exposures);
    }
    for (const [key, member] of Object.entries(value.reviews)) {
      const day = progress.planDays[key];
      if (!day || day.kind !== 'review') throw new Error('增量进度缺少复习轮次');
      if (member.queued) {
        day.reviewWordIds.push(id); day.reviewPriority![id] = member.priority ?? 2;
        if (member.rating) {
          day.reviewedWordIds.push(id);
          progress.reviewHistory.push({ ...structuredClone(member.rating), wordId: id, planDay: Number(key), reviewRoundId: day.reviewRoundId });
        }
      } else day.reviewSkippedWordIds!.push(id);
    }
    if (value.bookmark) {
      progress.bookmarkChanges![id] = { ...value.bookmark };
      if (value.bookmark.saved) progress.bookmarks[id] = value.bookmark.at;
    }
  }
  for (const day of Object.values(progress.planDays)) {
    day.ratedExposureKeys.sort(); day.reviewedWordIds.sort(); day.reviewSkippedWordIds?.sort();
    if (day.kind === 'review') day.reviewWordIds.sort((a, b) => day.reviewPriority![a] - day.reviewPriority![b] || a.localeCompare(b));
  }
  return progress;
}
