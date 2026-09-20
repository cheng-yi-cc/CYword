import type {
  AppProgress,
  Catalog,
  PlanDay,
  PlanDayProgress,
  Proficiency,
  StudyGroup,
} from "./types.ts";

export const proficiencyCopy: Record<Proficiency, { label: string; hint: string }> = {
  unmastered: { label: "未掌握", hint: "需要重点复习" },
  unclear: { label: "不清楚", hint: "有印象但不稳定" },
  mastered: { label: "已掌握", hint: "能够快速想起" },
};

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyProgress(): AppProgress {
  return { version: 2, planDays: {}, words: {}, bookmarks: {}, reviewHistory: [] };
}

export function normalizeProgress(raw: unknown): AppProgress {
  if (!raw || typeof raw !== "object") return emptyProgress();
  const source = raw as Record<string, unknown>;
  if (source.version === 2) {
    const progress = source as unknown as AppProgress;
    return {
      ...emptyProgress(),
      ...progress,
      planDays: progress.planDays ?? {},
      words: progress.words ?? {},
      bookmarks: progress.bookmarks ?? {},
      reviewHistory: progress.reviewHistory ?? [],
    };
  }

  const oldWords = (source.words ?? {}) as Record<string, Record<string, unknown>>;
  const words = Object.fromEntries(
    Object.entries(oldWords).map(([wordId, item]) => {
      const oldRating = String(item.lastRating ?? "");
      const proficiency: Proficiency = oldRating === "forgot"
        ? "unmastered"
        : oldRating === "remembered" || oldRating === "mastered"
          ? "mastered"
          : "unclear";
      return [wordId, {
        learnedAt: String(item.learnedAt ?? new Date().toISOString()),
        lastSeenAt: String(item.lastSeenAt ?? item.learnedAt ?? new Date().toISOString()),
        proficiency,
        reviewCount: Number(item.reviewCount ?? 0),
        exposures: Number(item.exposures ?? 1),
      }];
    }),
  );
  return { ...emptyProgress(), words };
}

export function buildPlan(catalog: Catalog): PlanDay[] {
  const groupsById = new Map(catalog.groups.map((group) => [group.id, group]));
  const learnedIds = new Set<string>();
  const plan: PlanDay[] = [];
  let planDay = 1;

  catalog.schedule.forEach((study, index) => {
    for (const groupId of study.groupIds) {
      for (const wordId of groupsById.get(groupId)?.wordIds ?? []) learnedIds.add(wordId);
    }
    plan.push({
      day: planDay++,
      kind: "study",
      studyDay: study.day,
      groupIds: study.groupIds,
      exposureOrder: study.exposureOrder,
      appearanceCount: study.appearanceCount,
      uniqueWordCount: study.uniqueWordCount,
    });
    if ((index + 1) % 3 === 0) {
      plan.push({
        day: planDay++,
        kind: "review",
        groupIds: [],
        appearanceCount: learnedIds.size,
        uniqueWordCount: learnedIds.size,
        plannedReviewWordCount: learnedIds.size,
      });
    }
  });
  return plan;
}

export function studyExposures(plan: Pick<PlanDay, "groupIds" | "exposureOrder">, groups: StudyGroup[]) {
  const byId = new Map(groups.map(group => [group.id, group]));
  const flat = plan.groupIds.flatMap(id => (byId.get(id)?.wordIds ?? []).map(wordId => ({
    groupId: id, wordId, key: `${id}:${wordId}`,
  })));
  return plan.exposureOrder ? plan.exposureOrder.map(index => flat[index]) : flat;
}

export function currentPlanDayNumber(progress: AppProgress, totalDays: number): number {
  let firstIncomplete = 1;
  while (firstIncomplete <= totalDays && progress.planDays[String(firstIncomplete)]?.completedAt) {
    firstIncomplete += 1;
  }
  const previous = firstIncomplete - 1;
  if (
    previous > 0 &&
    progress.planDays[String(previous)]?.completedAt?.slice(0, 10) === todayKey()
  ) return previous;
  return Math.min(firstIncomplete, totalDays);
}

export function isPlanDayComplete(progress: AppProgress, planDay: number): boolean {
  return Boolean(progress.planDays[String(planDay)]?.completedAt);
}

function freshDay(kind: "study" | "review", skipMastered = true): PlanDayProgress {
  return {
    kind,
    startedAt: new Date().toISOString(),
    completedGroupIds: [],
    ratedExposureKeys: [],
    reviewWordIds: [],
    reviewedWordIds: [],
    skipMastered,
  };
}

export function rateStudyWord(
  progress: AppProgress,
  plan: PlanDay,
  group: StudyGroup,
  wordId: string,
  proficiency: Proficiency,
): AppProgress {
  const next = structuredClone(progress);
  const now = new Date().toISOString();
  const dayKey = String(plan.day);
  const priorDay = progress.planDays[dayKey];
  const day = next.planDays[dayKey] ?? freshDay("study");
  const exposureKey = `${group.id}:${wordId}`;
  const isNewExposure = !priorDay?.ratedExposureKeys.includes(exposureKey);
  if (!day.ratedExposureKeys.includes(exposureKey)) day.ratedExposureKeys.push(exposureKey);
  next.planDays[dayKey] = day;

  const prior = next.words[wordId];
  next.words[wordId] = prior
    ? {
        ...prior,
        proficiency,
        lastSeenAt: now,
        exposures: prior.exposures + (isNewExposure ? 1 : 0),
      }
    : { learnedAt: now, lastSeenAt: now, proficiency, reviewCount: 0, exposures: 1 };

  const groupFinished = group.wordIds.every((id) => day.ratedExposureKeys.includes(`${group.id}:${id}`));
  if (groupFinished && !day.completedGroupIds.includes(group.id)) day.completedGroupIds.push(group.id);
  if (plan.groupIds.every((id) => day.completedGroupIds.includes(id))) day.completedAt = now;
  return next;
}

export function reviewCandidates(progress: AppProgress, skipMastered: boolean): string[] {
  const order: Record<Proficiency, number> = { unmastered: 0, unclear: 1, mastered: 2 };
  return Object.entries(progress.words)
    .filter(([, item]) => !(skipMastered && item.proficiency === "mastered"))
    .sort((a, b) => order[a[1].proficiency] - order[b[1].proficiency] || a[1].learnedAt.localeCompare(b[1].learnedAt))
    .map(([wordId]) => wordId);
}

export function startReviewDay(
  progress: AppProgress,
  planDay: number,
  wordIds: string[],
  skipMastered: boolean,
): AppProgress {
  const next = structuredClone(progress);
  const day = freshDay("review", skipMastered);
  day.reviewWordIds = [...new Set(wordIds)];
  if (day.reviewWordIds.length === 0) day.completedAt = new Date().toISOString();
  next.planDays[String(planDay)] = day;
  return next;
}

export function rateReviewWord(
  progress: AppProgress,
  planDay: number,
  wordId: string,
  proficiency: Proficiency,
): AppProgress {
  const next = structuredClone(progress);
  const now = new Date().toISOString();
  const day = next.planDays[String(planDay)];
  if (!day || !day.reviewWordIds.includes(wordId)) return progress;
  if (!day.reviewedWordIds.includes(wordId)) day.reviewedWordIds.push(wordId);
  const word = next.words[wordId];
  if (word) {
    word.proficiency = proficiency;
    word.reviewCount += 1;
    word.lastSeenAt = now;
  }
  next.reviewHistory.push({ wordId, date: now, proficiency, planDay });
  if (day.reviewWordIds.every((id) => day.reviewedWordIds.includes(id))) day.completedAt = now;
  return next;
}

/** Reassessing a known word must not complete a study exposure or a planned review. */
export function updateWordProficiency(progress: AppProgress, wordId: string, proficiency: Proficiency): AppProgress {
  if (!progress.words[wordId]) return progress;
  const next = structuredClone(progress);
  next.words[wordId].proficiency = proficiency;
  next.words[wordId].lastSeenAt = new Date().toISOString();
  return next;
}

/** The vocabulary list is derived from ratings; legacy bookmarks never determine membership. */
export function vocabularyOverview(progress: AppProgress, catalog: Catalog) {
  const counts = { unmastered: 0, unclear: 0, mastered: 0, unlearned: 0 };
  const ids: string[] = [];
  for (const id of Object.keys(catalog.words)) {
    const word = progress.words[id];
    if (!word) { counts.unlearned += 1; continue; }
    counts[word.proficiency] += 1;
    if (word.proficiency !== "mastered") ids.push(id);
  }
  ids.sort((a, b) => Number(progress.words[a].proficiency === "unclear") - Number(progress.words[b].proficiency === "unclear")
    || progress.words[a].lastSeenAt.localeCompare(progress.words[b].lastSeenAt) || a.localeCompare(b));
  return { counts, ids, total: Object.keys(catalog.words).length };
}

export function planDayFraction(progress: AppProgress, plan: PlanDay): number {
  const day = progress.planDays[String(plan.day)];
  if (!day) return 0;
  if (day.completedAt) return 1;
  if (plan.kind === "study") {
    return Math.min(1, day.ratedExposureKeys.length / Math.max(1, plan.appearanceCount));
  }
  return Math.min(1, day.reviewedWordIds.length / Math.max(1, day.reviewWordIds.length));
}

export function proficiencyCounts(progress: AppProgress) {
  const counts: Record<Proficiency, number> = { unmastered: 0, unclear: 0, mastered: 0 };
  for (const word of Object.values(progress.words)) counts[word.proficiency] += 1;
  return counts;
}

export function reconcileCompletion(progress: AppProgress, catalog: Catalog): AppProgress {
  const next = structuredClone(progress);
  const groups = new Map(catalog.groups.map((group) => [group.id, group]));
  // Exposure identity is group × word, independent of the day it used to belong to.
  const exposures = new Map<string, string>();
  for (const day of Object.values(progress.planDays)) {
    if (day.kind !== "study") continue;
    for (const key of day.ratedExposureKeys) {
      const startedAt = exposures.get(key);
      if (!startedAt || day.startedAt < startedAt) exposures.set(key, day.startedAt);
    }
  }
  next.planDays = Object.fromEntries(Object.entries(next.planDays).filter(([, day]) => day.kind === "review"));
  for (const plan of buildPlan(catalog)) {
    if (plan.kind !== "study") continue;
    const keys = plan.groupIds.flatMap((id) => groups.get(id)?.wordIds.map((wordId) => `${id}:${wordId}`) ?? []);
    const ratedExposureKeys = keys.filter((key) => exposures.has(key)).sort();
    if (!ratedExposureKeys.length) continue;
    const previous = progress.planDays[String(plan.day)];
    const day: PlanDayProgress = {
      kind: "study",
      startedAt: ratedExposureKeys.map((key) => exposures.get(key)!).sort()[0],
      completedGroupIds: plan.groupIds.filter((id) => groups.get(id)?.wordIds.every((wordId) => exposures.has(`${id}:${wordId}`))).sort(),
      ratedExposureKeys,
      reviewWordIds: [],
      reviewedWordIds: [],
      skipMastered: previous?.skipMastered ?? true,
    };
    if (ratedExposureKeys.length === keys.length) {
      const sameMembership = previous?.kind === "study" && previous.ratedExposureKeys.length === keys.length
        && previous.ratedExposureKeys.every((key) => keys.includes(key));
      day.completedAt = (sameMembership && previous.completedAt) || ratedExposureKeys
        .map((key) => next.words[key.slice(key.lastIndexOf(":") + 1)]?.lastSeenAt).filter(Boolean).sort().at(-1) || day.startedAt;
    }
    next.planDays[String(plan.day)] = day;
  }
  return next;
}
