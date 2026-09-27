import { buildPlan, reconcileCompletion, reviewAccess, isPlanDayComplete, type PlanCatalog } from "./progress.ts";
import { validProgress } from "./progress-validation.ts";
import { mergeProgress } from "./sync-merge.ts";
import type { AppProgress } from "./types.ts";

/** Uses the compiled curriculum, never a client-supplied list of days or words. */
function inspectProgress(input: unknown, catalog: PlanCatalog) {
  if (!validProgress(input)) throw new Error("学习进度结构无效");
  const plan = buildPlan(catalog);
  const byDay = new Map(plan.map(day => [day.day, day]));
  const reviewQueues = new Map<number, Set<string>>();
  const knownWords = new Set(catalog.groups.flatMap((group) => group.wordIds));
  for (const id of [...Object.keys(input.words), ...Object.keys(input.bookmarks), ...Object.keys(input.bookmarkChanges ?? {})]) {
    if (!knownWords.has(id)) throw new Error("进度含当前词书以外的单词");
  }
  for (const [key, saved] of Object.entries(input.planDays)) {
    const day = byDay.get(Number(key));
    if (!day || day.kind !== saved.kind) throw new Error("计划日期或类型不匹配");
    if (day.kind === "study") {
      const exposureKeys = new Set(day.exposureKeys);
      if (saved.ratedExposureKeys.some((id) => !exposureKeys.has(id) || !input.words[id.slice(id.lastIndexOf(":") + 1)])
        || saved.completedGroupIds.some((id) => !day.groupIds.includes(id)) || saved.reviewWordIds.length || saved.reviewedWordIds.length) {
        throw new Error("学习曝光与当前计划不匹配");
      }
    } else {
      if (saved.reviewRoundId !== day.reviewRoundId || saved.ratedExposureKeys.length || saved.completedGroupIds.length) throw new Error("复习轮次不匹配");
      const queue = new Set(saved.reviewWordIds), skipped = new Set(saved.reviewSkippedWordIds ?? []);
      reviewQueues.set(day.day, queue);
      const scope = new Set(day.reviewWordIds);
      if (queue.size !== saved.reviewWordIds.length || skipped.size !== (saved.reviewSkippedWordIds ?? []).length
        || queue.size + skipped.size !== scope.size || [...queue].some((id) => !scope.has(id) || skipped.has(id))
        || [...skipped].some((id) => !scope.has(id)) || (skipped.size > 0 && !saved.skipMastered)
        || (!queue.size && saved.emptyReviewConfirmed !== true)) throw new Error("复习范围缺失或跳过记录无效");
      if (!saved.reviewPriority || Object.keys(saved.reviewPriority).length !== queue.size
        || Object.keys(saved.reviewPriority).some((id) => !queue.has(id))) throw new Error("复习顺序无效");
    }
  }
  for (const record of input.reviewHistory) {
    const day = byDay.get(record.planDay);
    if (!day || day.kind !== "review" || record.reviewRoundId !== day.reviewRoundId || !reviewQueues.get(record.planDay)?.has(record.wordId)
      || !input.words[record.wordId]) throw new Error("复习记录与轮次或词汇不匹配");
  }
  return { progress: input, plan };
}

/** Storage checks do not need to clone and normalize an already saved snapshot. */
export function assertBookProgress(input: unknown, catalog: PlanCatalog): asserts input is AppProgress {
  const { progress, plan } = inspectProgress(input, catalog);
  for (const day of plan) if (day.kind === "review" && progress.planDays[String(day.day)]) {
    const access = reviewAccess(progress, plan, day.day);
    if (!access.allowed) throw new Error(access.reason);
  }
}

export function canonicalProgress(input: unknown, catalog: PlanCatalog): AppProgress {
  const { progress, plan } = inspectProgress(input, catalog);
  const next = reconcileCompletion(mergeProgress(progress, progress), catalog);
  for (const day of plan) {
    const saved = next.planDays[String(day.day)];
    if (day.kind !== "review" || !saved) continue;
    const access = reviewAccess(next, plan, day.day);
    if (!access.allowed) throw new Error(access.reason);
    // Membership comes from actual round ratings. A forged completedAt never counts.
    saved.reviewedWordIds = [...new Set(next.reviewHistory.filter((entry) => entry.reviewRoundId === day.reviewRoundId).map((entry) => entry.wordId))].sort();
    if (isPlanDayComplete(next, day)) {
      saved.completedAt = next.reviewHistory.filter((entry) => entry.reviewRoundId === day.reviewRoundId).map((entry) => entry.date).sort().at(-1) ?? saved.startedAt;
    } else delete saved.completedAt;
  }
  const exposures = new Map<string, Set<string>>();
  for (const day of Object.values(next.planDays)) for (const key of day.ratedExposureKeys) {
    const id = key.slice(key.lastIndexOf(":") + 1);
    if (!exposures.has(id)) exposures.set(id, new Set());
    exposures.get(id)!.add(key);
  }
  const reviews = new Map<string, number>();
  for (const item of next.reviewHistory) reviews.set(item.wordId, (reviews.get(item.wordId) ?? 0) + 1);
  for (const [id, word] of Object.entries(next.words)) {
    word.exposures = exposures.get(id)?.size ?? 0;
    word.reviewCount = reviews.get(id) ?? 0;
  }
  return next;
}
