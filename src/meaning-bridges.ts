import type { AppProgress, Catalog, MeaningBridge, WordDetail } from "./types.ts";
import { buildPlan, studyExposures } from "./progress.ts";

export interface StudyPosition { day: number; index: number }
export interface BridgeOrder {
  first: Map<string, number>;
  days: Map<number, { offset: number; wordIds: string[] }>;
}

export function buildBridgeOrder(catalog: Catalog): BridgeOrder {
  const first = new Map<string, number>();
  const days: BridgeOrder["days"] = new Map();
  let offset = 0;
  for (const day of buildPlan(catalog)) {
    if (day.kind !== "study") continue;
    const wordIds = studyExposures(day, catalog.groups).map(item => item.wordId);
    days.set(day.day, { offset, wordIds });
    wordIds.forEach((id, index) => { if (!first.has(id)) first.set(id, offset + index); });
    offset += wordIds.length;
  }
  return { first, days };
}

export function hasLearningRecord(progress: AppProgress | null, id: string): boolean {
  const record = progress?.words[id];
  return !!record?.learnedAt && ["unmastered", "unclear", "mastered"].includes(record.proficiency);
}

export function selectMeaningBridge(
  detail: WordDetail, catalog: Catalog, progress: AppProgress | null, order: BridgeOrder, position?: StudyPosition,
): MeaningBridge | undefined {
  if (detail.bookCode !== catalog.book.code || !catalog.words[detail.id]) return undefined;
  const day = position ? order.days.get(position.day) : undefined;
  // 学习页按本次曝光位置判断，回看、复习和词汇详情默认按该词首次位置。
  const cutoff = day && position && day.wordIds[position.index] === detail.id
    ? day.offset + position.index : order.first.get(detail.id);
  const candidates = (detail.meaningBridges ?? []).filter(bridge => {
    const anchor = catalog.words[bridge.anchorId];
    if (bridge.anchorId === detail.id || !anchor || anchor.spelling !== bridge.anchorSpelling || !bridge.explanation) return false;
    if (!["near_synonym", "antonym"].includes(bridge.relation)) return false;
    const anchorIndex = order.first.get(bridge.anchorId);
    return hasLearningRecord(progress, bridge.anchorId) || (cutoff !== undefined && anchorIndex !== undefined && anchorIndex < cutoff);
  });
  const rank = (bridge: MeaningBridge) => hasLearningRecord(progress, bridge.anchorId)
    ? progress?.words[bridge.anchorId].proficiency === "mastered" ? 0 : 1 : 2;
  return candidates.sort((a, b) => rank(a) - rank(b)
    || (order.first.get(a.anchorId) ?? Infinity) - (order.first.get(b.anchorId) ?? Infinity)
    || a.anchorId.localeCompare(b.anchorId))[0];
}
