import curriculum from "../data/curriculum.json" with { type: "json" };
import type { Catalog, StudyDayPlan } from "./types.ts";

/** Share the compiled curriculum across installed clients and legacy API catalogs. */
export function applyCurriculum(catalog: Catalog): Catalog {
  if (catalog.book.code !== curriculum.bookCode) return catalog;
  const remote = new Map(catalog.groups.map(group => [group.id, group]));
  if (remote.size !== curriculum.groups.length || curriculum.groups.some(group => {
    const source = remote.get(group.id);
    const members = new Set(source?.wordIds);
    return !source || members.size !== group.wordIds.length || group.wordIds.some(id => !members.has(id));
  })) throw new Error("词书分组已更新，请更新应用后继续学习。已学记录保留在当前账号中。");
  return {
    ...catalog,
    groups: curriculum.groups.map(group => ({ ...remote.get(group.id)!, wordIds: [...group.wordIds] })),
    schedule: curriculum.schedule as StudyDayPlan[],
    stats: { ...catalog.stats, scheduleDayCount: curriculum.schedule.length },
  };
}
