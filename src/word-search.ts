import { buildPlan, studyExposures } from "./progress.ts";
import type { Catalog } from "./types.ts";

/** Use first appearance in the current curriculum, including its dependency order. */
export function bookWordOrder(catalog: Catalog): string[] {
  return [...new Set(buildPlan(catalog).filter((day) => day.kind === "study")
    .flatMap((day) => studyExposures(day, catalog.groups).map((item) => item.wordId)))];
}

export function searchBookWords(catalog: Catalog, orderedIds: string[], query: string): string[] {
  const prefix = query.trim().toLowerCase();
  if (!prefix) return [];
  return orderedIds.filter((id) => catalog.words[id]?.spelling.toLowerCase().startsWith(prefix));
}
