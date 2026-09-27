import { buildPlan, emptyProgress, startReviewDay, reconcileCompletion } from "../src/progress.ts";
import { canonicalProgress } from "../src/progress-business.ts";
import type { PlanCatalog } from "../src/progress.ts";

/** Synthetic high-progress fixture, never a real learner's history. */
export function fullProgressFixture(catalog: PlanCatalog) {
  const plan = buildPlan(catalog), stamp = "2026-09-01T00:00:00.000Z";
  let progress = emptyProgress();
  for (const id of new Set(catalog.groups.flatMap(group => group.wordIds))) progress.words[id] = {
    learnedAt: stamp, lastSeenAt: stamp, proficiency: "unclear", exposures: 0, reviewCount: 0, ratingVersion: { counter: 1, actor: "benchmark" },
  };
  progress = reconcileCompletion(progress, catalog);
  for (const day of plan) if (day.kind === "study") progress.planDays[String(day.day)].ratedExposureKeys = [...day.exposureKeys!];
  for (const day of plan) if (day.kind === "review") {
    progress = startReviewDay(progress, plan, day.day, false);
    const saved = progress.planDays[String(day.day)];
    saved.reviewedWordIds = [...saved.reviewWordIds];
    for (const id of saved.reviewWordIds) {
      const ratingVersion = { counter: day.day, actor: "00000000-0000-4000-8000-000000000001" };
      progress.words[id].ratingVersion = ratingVersion;
      progress.reviewHistory.push({ wordId: id, planDay: day.day, reviewRoundId: day.reviewRoundId, date: stamp, proficiency: "unclear", ratingVersion });
    }
  }
  return canonicalProgress(progress, catalog);
}
