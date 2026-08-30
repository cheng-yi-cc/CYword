import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

function packStudyDays(groups, target = 190) {
  const days = [];
  let count = 0;
  let ids = [];
  for (const group of groups) {
    const currentDistance = Math.abs(target - count);
    const nextDistance = Math.abs(target - (count + group.size));
    if (ids.length && count >= target * 0.82 && nextDistance > currentDistance) {
      days.push({ ids, count });
      ids = [];
      count = 0;
    }
    ids.push(group.id);
    count += group.size;
  }
  if (ids.length) days.push({ ids, count });
  return days;
}

test("atomic groups are never split while days stay near target", () => {
  const groups = Array.from({ length: 100 }, (_, index) => ({
    id: `g${index}`,
    size: (index % 17) + 1,
  }));
  const days = packStudyDays(groups);
  assert.deepEqual(days.flatMap((day) => day.ids), groups.map((group) => group.id));
  assert.equal(new Set(days.flatMap((day) => day.ids)).size, groups.length);
  assert.ok(days.slice(0, -1).every((day) => day.count >= 155 && day.count <= 207));
});

test("duplicate word appearances can be deduplicated by word id", () => {
  const groupA = ["w1", "w2"];
  const groupB = ["w1", "w3"];
  assert.deepEqual([...new Set([...groupA, ...groupB])], ["w1", "w2", "w3"]);
});

test("the generated full-data schedule keeps every day near 190 without splitting groups", () => {
  const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
  const scheduledIds = catalog.schedule.flatMap((day) => day.groupIds);
  assert.equal(scheduledIds.length, catalog.groups.length);
  assert.equal(new Set(scheduledIds).size, catalog.groups.length);
  assert.equal(catalog.schedule.length % 3, 0);
  assert.ok(catalog.schedule.every((day) => day.appearanceCount >= 165 && day.appearanceCount <= 205));
  const total = catalog.schedule.reduce((sum, day) => sum + day.appearanceCount, 0);
  assert.equal(total, catalog.stats.studyAppearanceCount);
});
