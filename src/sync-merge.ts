import type { AppProgress, PlanDayProgress } from "./types";

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
const newest = <T>(a: T, b: T, stamp: (value: T) => string): T => {
  const compare = stamp(a).localeCompare(stamp(b));
  return compare > 0 || (compare === 0 && JSON.stringify(a) >= JSON.stringify(b)) ? a : b;
};

/** Completion is cumulative; ratings and bookmark removals use their change times. */
export function mergeProgress(a: AppProgress, b: AppProgress): AppProgress {
  const result: AppProgress = { version: 2, words: {}, planDays: {}, bookmarks: {}, bookmarkChanges: {}, reviewHistory: [] };
  for (const id of union(Object.keys(a.words), Object.keys(b.words))) {
    const x = a.words[id], y = b.words[id];
    result.words[id] = x && y ? {
      ...newest(x, y, (word) => word.lastSeenAt),
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
    } else if (x.startedAt === y.startedAt) {
      day.reviewWordIds = [...latest.reviewWordIds, ...union(x.reviewWordIds, y.reviewWordIds).filter((id) => !latest.reviewWordIds.includes(id))];
      day.reviewedWordIds = union(x.reviewedWordIds, y.reviewedWordIds).filter((id) => day.reviewWordIds.includes(id));
      if (day.reviewWordIds.every((id) => day.reviewedWordIds.includes(id))) {
        day.completedAt = [x.completedAt, y.completedAt, ...day.reviewedWordIds.map((id) => result.words[id]?.lastSeenAt)].filter(Boolean).sort().at(-1) ?? day.startedAt;
      }
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
  const history = new Map([...a.reviewHistory, ...b.reviewHistory].map((item) => [JSON.stringify([item.planDay, item.wordId, item.date, item.proficiency]), item]));
  result.reviewHistory = [...history.entries()].sort(([ka], [kb]) => ka.localeCompare(kb)).map(([, item]) => ({ ...item }));
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
