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

export interface PlanCatalog {
  groups: Array<Pick<StudyGroup, "id" | "wordIds">>;
  schedule: Catalog["schedule"];
  book?: Pick<Catalog["book"], "code">;
  dataVersion?: string;
  curriculumVersion?: string;
}

export function buildPlan(catalog: PlanCatalog): PlanDay[] {
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
      exposureKeys: studyExposures(study, catalog.groups).map((item) => item.key),
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
        reviewWordIds: [...learnedIds],
        reviewRoundId: `${catalog.book?.code ?? "cet6"}:${catalog.curriculumVersion ?? catalog.dataVersion ?? "unversioned"}:review:${planDay - 1}`,
      });
    }
  });
  return plan;
}

export function studyExposures(plan: Pick<PlanDay, "groupIds" | "exposureOrder">, groups: PlanCatalog["groups"]) {
  const byId = new Map(groups.map(group => [group.id, group]));
  const flat = plan.groupIds.flatMap(id => (byId.get(id)?.wordIds ?? []).map(wordId => ({
    groupId: id, wordId, key: `${id}:${wordId}`,
  })));
  return plan.exposureOrder ? plan.exposureOrder.map(index => flat[index]) : flat;
}

/** Learned words count in every scheduled group without inventing rating events. */
export function completedStudyExposureKeys(progress: AppProgress, plan: PlanDay): string[] {
  const rated = progress.planDays[String(plan.day)]?.ratedExposureKeys ?? [];
  if (!plan.exposureKeys) return rated;
  return plan.exposureKeys.filter((key) => isProficiency(progress.words[key.slice(key.lastIndexOf(":") + 1)]?.proficiency));
}

export function isProficiency(value: unknown): value is Proficiency {
  return value === "unmastered" || value === "unclear" || value === "mastered";
}

/** null is the explicit end of the plan, never an invented next day. */
export function currentPlanDayNumber(progress: AppProgress, plan: PlanDay[]): number | null {
  return plan.find((day) => !isPlanDayComplete(progress, day))?.day ?? null;
}

export function reviewedWords(progress: AppProgress, plan: PlanDay): string[] {
  const day = progress.planDays[String(plan.day)];
  if (!day || day.kind !== "review" || day.reviewRoundId !== plan.reviewRoundId) return [];
  const valid = new Set(progress.reviewHistory.filter((item) => item.planDay === plan.day
    && item.reviewRoundId === plan.reviewRoundId && isProficiency(item.proficiency)).map((item) => item.wordId));
  const reviewed = new Set(day.reviewedWordIds);
  return [...new Set(day.reviewWordIds)].filter((id) => reviewed.has(id) && valid.has(id));
}

export function isPlanDayComplete(progress: AppProgress, plan: PlanDay): boolean {
  if (plan.kind === "study") {
    return completedStudyExposureKeys(progress, plan).length === plan.appearanceCount;
  }
  const day = progress.planDays[String(plan.day)];
  if (!day || day.kind !== "review" || day.reviewRoundId !== plan.reviewRoundId) return false;
  return day.reviewWordIds.length > 0
    ? reviewedWords(progress, plan).length === new Set(day.reviewWordIds).size
    : day.emptyReviewConfirmed === true;
}

export function reviewAccess(progress: AppProgress, plan: PlanDay[], dayNumber: number): { allowed: boolean; reason: string } {
  const target = plan.find((day) => day.day === dayNumber);
  if (!target || target.kind !== "review") return { allowed: false, reason: "复习日不存在。" };
  const missing = plan.find((day) => day.day < dayNumber && !isPlanDayComplete(progress, day));
  if (!missing) return { allowed: true, reason: "" };
  const remaining = missing.kind === "study"
    ? new Set((missing.exposureKeys ?? []).filter((key) => !isProficiency(progress.words[key.slice(key.lastIndexOf(":") + 1)]?.proficiency))
      .map((key) => key.slice(key.lastIndexOf(":") + 1))).size
    : Math.max(0, (progress.planDays[String(missing.day)]?.reviewWordIds.length ?? 0) - reviewedWords(progress, missing).length);
  const detail = missing.kind === "study" ? `还有 ${remaining} 个单词未标记。`
    : remaining ? `还有 ${remaining} 个单词未完成本轮复习。` : "复习尚未完成。";
  return { allowed: false, reason: `请先完成前面的学习与复习。Day ${missing.day} ${detail}` };
}

function requireReviewAccess(progress: AppProgress, plan: PlanDay[], dayNumber: number): PlanDay {
  const access = reviewAccess(progress, plan, dayNumber);
  if (!access.allowed) throw new Error(access.reason);
  return plan.find((day) => day.day === dayNumber)!;
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
  if (!isProficiency(proficiency) || plan.kind !== "study" || !plan.groupIds.includes(group.id) || !group.wordIds.includes(wordId)) {
    throw new Error("无效的学习评级");
  }
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

  const groupFinished = group.wordIds.every((id) => isProficiency(next.words[id]?.proficiency));
  if (groupFinished && !day.completedGroupIds.includes(group.id)) day.completedGroupIds.push(group.id);
  if (plan.groupIds.every((id) => day.completedGroupIds.includes(id))) day.completedAt = now;
  return next;
}

export function reviewCandidates(progress: AppProgress, skipMastered: boolean, plan?: PlanDay): string[] {
  const order: Record<Proficiency, number> = { unmastered: 0, unclear: 1, mastered: 2 };
  const scope = new Set(plan?.reviewWordIds);
  return Object.entries(progress.words)
    .filter(([id, item]) => isProficiency(item.proficiency) && (!plan || scope.has(id)) && !(skipMastered && item.proficiency === "mastered"))
    .sort((a, b) => order[a[1].proficiency] - order[b[1].proficiency] || a[1].learnedAt.localeCompare(b[1].learnedAt))
    .map(([wordId]) => wordId);
}

export function startReviewDay(
  progress: AppProgress,
  plan: PlanDay[],
  planDay: number,
  skipMastered: boolean,
  confirmEmpty = false,
): AppProgress {
  const target = requireReviewAccess(progress, plan, planDay);
  const existing = progress.planDays[String(planDay)];
  if (existing?.reviewRoundId === target.reviewRoundId) return progress;
  const wordIds = reviewCandidates(progress, skipMastered, target);
  if (!wordIds.length && !confirmEmpty) throw new Error("本轮没有需要复习的单词，请确认后完成。");
  const next = structuredClone(progress);
  const day = freshDay("review", skipMastered);
  day.reviewWordIds = wordIds;
  day.reviewRoundId = target.reviewRoundId;
  const queued = new Set(wordIds);
  day.reviewSkippedWordIds = (target.reviewWordIds ?? []).filter((id) => !queued.has(id));
  day.reviewPriority = Object.fromEntries(wordIds.map((id) => [id, { unmastered: 0, unclear: 1, mastered: 2 }[progress.words[id].proficiency]]));
  day.reviewWordIds.sort((a, b) => day.reviewPriority![a] - day.reviewPriority![b] || a.localeCompare(b));
  if (!wordIds.length) {
    day.emptyReviewConfirmed = true;
    day.completedAt = day.startedAt;
  }
  next.planDays[String(planDay)] = day;
  return next;
}

export function rateReviewWord(
  progress: AppProgress,
  plan: PlanDay[],
  planDay: number,
  wordId: string,
  proficiency: Proficiency,
): AppProgress {
  const target = requireReviewAccess(progress, plan, planDay);
  if (!isProficiency(proficiency)) throw new Error("无效的复习评级");
  const next = structuredClone(progress);
  const now = new Date().toISOString();
  const day = next.planDays[String(planDay)];
  if (!day || day.reviewRoundId !== target.reviewRoundId || !day.reviewWordIds.includes(wordId)) throw new Error("请先开始本轮复习");
  const firstReview = !reviewedWords(progress, target).includes(wordId);
  if (!day.reviewedWordIds.includes(wordId)) day.reviewedWordIds.push(wordId);
  const word = next.words[wordId];
  if (word) {
    word.proficiency = proficiency;
    word.reviewCount += firstReview ? 1 : 0;
    word.lastSeenAt = now;
  }
  next.reviewHistory = next.reviewHistory.filter((item) => !(item.wordId === wordId && item.planDay === planDay && item.reviewRoundId === target.reviewRoundId));
  next.reviewHistory.push({ wordId, date: now, proficiency, planDay, reviewRoundId: target.reviewRoundId });
  if (isPlanDayComplete(next, target)) day.completedAt = now;
  return next;
}

/** Reassessing a known word must not complete a study exposure or a planned review. */
export function updateWordProficiency(progress: AppProgress, wordId: string, proficiency: Proficiency): AppProgress {
  if (!isProficiency(proficiency)) throw new Error("无效的单词评级");
  if (!progress.words[wordId]) return progress;
  const next = structuredClone(progress);
  next.words[wordId].proficiency = proficiency;
  next.words[wordId].lastSeenAt = new Date().toISOString();
  return next;
}

/** Search can teach a new word, but does not create a planned exposure or review event. */
export function rateSearchWord(progress: AppProgress, wordId: string, proficiency: Proficiency): AppProgress {
  if (!isProficiency(proficiency)) throw new Error("无效的单词评级");
  if (progress.words[wordId]) return updateWordProficiency(progress, wordId, proficiency);
  const next = structuredClone(progress);
  const now = new Date().toISOString();
  next.words[wordId] = { learnedAt: now, lastSeenAt: now, proficiency, reviewCount: 0, exposures: 0 };
  return next;
}

/** The vocabulary list is derived from ratings; legacy bookmarks never determine membership. */
export function vocabularyOverview(progress: AppProgress, catalog: Catalog) {
  const counts = { unmastered: 0, unclear: 0, mastered: 0, unlearned: 0 };
  const ids: string[] = [];
  for (const id of Object.keys(catalog.words)) {
    const word = progress.words[id];
    if (!word || !isProficiency(word.proficiency)) { counts.unlearned += 1; continue; }
    counts[word.proficiency] += 1;
    if (word.proficiency !== "mastered") ids.push(id);
  }
  ids.sort((a, b) => Number(progress.words[a].proficiency === "unclear") - Number(progress.words[b].proficiency === "unclear")
    || progress.words[a].lastSeenAt.localeCompare(progress.words[b].lastSeenAt) || a.localeCompare(b));
  return { counts, ids, total: Object.keys(catalog.words).length };
}

export function planDayFraction(progress: AppProgress, plan: PlanDay): number {
  const day = progress.planDays[String(plan.day)];
  if (plan.kind === "study") {
    return Math.min(1, completedStudyExposureKeys(progress, plan).length / Math.max(1, plan.appearanceCount));
  }
  if (!day) return 0;
  if (isPlanDayComplete(progress, plan)) return 1;
  return Math.min(1, reviewedWords(progress, plan).length / Math.max(1, day.reviewWordIds.length));
}

export function proficiencyCounts(progress: AppProgress) {
  const counts: Record<Proficiency, number> = { unmastered: 0, unclear: 0, mastered: 0 };
  for (const word of Object.values(progress.words)) if (isProficiency(word.proficiency)) counts[word.proficiency] += 1;
  return counts;
}

export function reconcileCompletion(progress: AppProgress, catalog: PlanCatalog): AppProgress {
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
    const credited = new Map(keys.flatMap((key) => {
      const word = next.words[key.slice(key.lastIndexOf(":") + 1)];
      const learnedAt = isProficiency(word?.proficiency) ? word.learnedAt : undefined;
      return learnedAt ? [[key, learnedAt] as const] : [];
    }));
    if (!credited.size) continue;
    const previous = progress.planDays[String(plan.day)];
    const day: PlanDayProgress = {
      kind: "study",
      startedAt: [...credited.values()].sort()[0],
      completedGroupIds: plan.groupIds.filter((id) => groups.get(id)?.wordIds.every((wordId) => credited.has(`${id}:${wordId}`))).sort(),
      ratedExposureKeys,
      reviewWordIds: [],
      reviewedWordIds: [],
      skipMastered: previous?.skipMastered ?? true,
    };
    if (credited.size === keys.length) {
      const sameMembership = previous?.kind === "study" && previous.completedGroupIds.length === plan.groupIds.length
        && previous.completedGroupIds.every((id) => plan.groupIds.includes(id));
      day.completedAt = (sameMembership && previous.completedAt) || [...credited.values()].sort().at(-1) || day.startedAt;
    }
    next.planDays[String(plan.day)] = day;
  }
  return next;
}
