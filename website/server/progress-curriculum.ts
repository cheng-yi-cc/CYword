import curriculum from "../../data/curriculum.json" with { type: "json" };
import type { PlanCatalog } from "../../src/progress.ts";

export const progressCatalog: PlanCatalog = {
  book: { code: curriculum.bookCode },
  curriculumVersion: curriculum.curriculumVersion,
  groups: curriculum.groups,
  schedule: curriculum.schedule,
};
export const progressProtocol = { protocol: 1, bookCode: curriculum.bookCode, curriculumVersion: curriculum.curriculumVersion };
