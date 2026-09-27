import type { AppProgress, PlanDayProgress } from "./types";

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
const newest = <T>(a: T, b: T, stamp: (value: T) => string): T => {
  if (a === b) return a;
  const compare = stamp(a).localeCompare(stamp(b));
  return compare > 0 || (compare === 0 && JSON.stringify(a) >= JSON.stringify(b)) ? a : b;
};

/** Observed changes advance a per-word Lamport counter; offline ties use actor ID.
 * Timestamps remain diagnostics, and never outrank a logical version. */
const latestRating = <T extends { ratingVersion?: { counter: number; actor: string } }>(a: T, b: T, stamp: (value: T) => string): T => {
  if (a === b) return a;
  const ac = a.ratingVersion?.counter ?? 0, bc = b.ratingVersion?.counter ?? 0;
  if (ac !== bc) return ac > bc ? a : b;
  const actor = (a.ratingVersion?.actor ?? "").localeCompare(b.ratingVersion?.actor ?? "");
  if (actor) return actor > 0 ? a : b;
  return newest(a, b, stamp);
};

/** Completion is cumulative; ratings and bookmark removals use their change times. */
export function mergeProgress(a: AppProgress, b: AppProgress): AppProgress {
  const result: AppProgress = { version: 2, words: {}, planDays: {}, bookmarks: {}, bookmarkChanges: {}, reviewHistory: [] };
  for (const id of union(Object.keys(a.words), Object.keys(b.words))) {
    const x = a.words[id], y = b.words[id];
    result.words[id] = x && y ? {
      ...latestRating(x, y, (word) => word.lastSeenAt),
      learnedAt: x.learnedAt < y.learnedAt ? x.learnedAt : y.learnedAt,
      exposures: Math.max(x.exposures, y.exposures),
      reviewCount: Math.max(x.reviewCount, y.reviewCount),
    } : structuredClone(x ?? y);
  }
  for (const key of union(Object.keys(a.planDays), Object.keys(b.planDays))) {
    const x = a.planDays[key], y = b.planDays[key];
    if (!x || !y) { result.planDays[key] = structuredClone(x ?? y); continue; }
    const latest = newest(x, y, (day) => day.startedAt);
    const day: PlanDayProgress = {
      ...structuredClone(latest),
      completedGroupIds: union(x.completedGroupIds, y.completedGroupIds),
      ratedExposureKeys: union(x.ratedExposureKeys, y.ratedExposureKeys),
    };
    if (x.kind === "study") {
      day.startedAt = x.startedAt < y.startedAt ? x.startedAt : y.startedAt;
      const completedAt = [x.completedAt, y.completedAt].filter(Boolean).sort()[0];
      if (completedAt) day.completedAt = completedAt;
      else delete day.completedAt;
    } else if ((x.reviewRoundId && x.reviewRoundId === y.reviewRoundId) || (!x.reviewRoundId && !y.reviewRoundId && x.startedAt === y.startedAt)) {
      day.startedAt = x.startedAt < y.startedAt ? x.startedAt : y.startedAt;
      day.reviewWordIds = union(x.reviewWordIds, y.reviewWordIds);
      if (day.reviewRoundId) {
        day.reviewPriority = Object.fromEntries(day.reviewWordIds.map((id) => [id, Math.min(x.reviewPriority?.[id] ?? 2, y.reviewPriority?.[id] ?? 2)]));
        day.reviewWordIds.sort((a, b) => day.reviewPriority![a] - day.reviewPriority![b] || a.localeCompare(b));
        day.skipMastered = x.skipMastered && y.skipMastered;
        const queue = new Set(day.reviewWordIds);
        day.reviewSkippedWordIds = union(x.reviewSkippedWordIds ?? [], y.reviewSkippedWordIds ?? []).filter((id) => !queue.has(id));
        if (!day.reviewWordIds.length && (x.emptyReviewConfirmed || y.emptyReviewConfirmed)) day.emptyReviewConfirmed = true;
        else delete day.emptyReviewConfirmed;
      }
      const queue = new Set(day.reviewWordIds);
      day.reviewedWordIds = union(x.reviewedWordIds, y.reviewedWordIds).filter((id) => queue.has(id));
      const reviewed = new Set(day.reviewedWordIds);
      if ((day.reviewWordIds.length > 0 || day.emptyReviewConfirmed) && day.reviewWordIds.every((id) => reviewed.has(id))) {
        day.completedAt = [x.completedAt, y.completedAt, ...day.reviewedWordIds.map((id) => result.words[id]?.lastSeenAt)].filter(Boolean).sort().at(-1) ?? day.startedAt;
      } else delete day.completedAt;
    }
    result.planDays[key] = day;
  }
  const changes = (progress: AppProgress) => ({
    ...Object.fromEntries(Object.entries(progress.bookmarks).map(([id, at]) => [id, { at, saved: true }])),
    ...progress.bookmarkChanges,
  });
  const ax = changes(a), bx = changes(b);
  for (const id of union(Object.keys(ax), Object.keys(bx))) {
    const change = ax[id] && bx[id] ? newest(ax[id], bx[id], (item) => item.at) : ax[id] ?? bx[id];
    result.bookmarkChanges![id] = { ...change };
    if (change.saved) result.bookmarks[id] = change.at;
  }
  const history = new Map<string, AppProgress["reviewHistory"][number]>();
  for (const item of a === b ? a.reviewHistory : [...a.reviewHistory, ...b.reviewHistory]) {
    const key = item.reviewRoundId ? JSON.stringify([item.reviewRoundId, item.wordId]) : JSON.stringify([item.planDay, item.wordId, item.date, item.proficiency]);
    const prior = history.get(key);
    history.set(key, prior ? latestRating(prior, item, (entry) => entry.date) : item);
  }
  result.reviewHistory = [...history.entries()].sort(([ka], [kb]) => ka.localeCompare(kb)).map(([, item]) => ({ ...item }));
  for (const [key, day] of Object.entries(result.planDays)) {
    if (day.kind !== "review" || !day.reviewRoundId) continue;
    const valid = new Set(result.reviewHistory.filter((item) => item.planDay === Number(key) && item.reviewRoundId === day.reviewRoundId).map((item) => item.wordId));
    day.reviewedWordIds = day.reviewedWordIds.filter((id) => valid.has(id));
    const reviewed = new Set(day.reviewedWordIds);
    if (day.reviewWordIds.length ? day.reviewWordIds.every((id) => reviewed.has(id)) : day.emptyReviewConfirmed) {
      // Completion is derived from this round's records, never the uploaded flag.
      day.completedAt = result.reviewHistory.filter((item) => item.reviewRoundId === day.reviewRoundId).map((item) => item.date).sort().at(-1) ?? day.startedAt;
    } else delete day.completedAt;
  }
  // Count unique exposures/history when devices completed different words concurrently.
  const exposures = new Map<string, Set<string>>();
  for (const value of Object.values(result.planDays)) for (const key of value.ratedExposureKeys) {
    const id = key.slice(key.lastIndexOf(":") + 1);
    if (!exposures.has(id)) exposures.set(id, new Set());
    exposures.get(id)!.add(key);
  }
  const reviews = new Map<string, number>();
  for (const item of result.reviewHistory) reviews.set(item.wordId, (reviews.get(item.wordId) ?? 0) + 1);
  for (const [id, word] of Object.entries(result.words)) {
    word.exposures = Math.max(word.exposures, exposures.get(id)?.size ?? 0);
    word.reviewCount = Math.max(word.reviewCount, reviews.get(id) ?? 0);
  }
  return result;
}
