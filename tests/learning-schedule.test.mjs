import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { extractDependencies, buildLearningSchedule } from "../scripts/learning-schedule.mjs";
import { buildPlan, studyExposures } from "../src/progress.ts";
import { applyCurriculum } from "../src/curriculum.ts";

const raw = parse(fs.readFileSync("books/cet6/csv/words.csv", "utf8"), { columns: true, bom: true });
const words = raw.map(row => ({ id: row.word_id, spelling: row.spelling, memoryMarkup: row.memory_markup, etymologyMarkup: row.etymology_markup, originalOrder: Number(row.word_order || row.order_in_day) }));
const dependencies = extractDependencies(words);
const catalog = JSON.parse(fs.readFileSync("data/catalog.json", "utf8"));
const plan = buildPlan(catalog);

test("study pauses preserve whole root groups and end at the final exposure", () => {
  for (const day of plan.filter(day => day.kind === "study")) {
    const exposures = studyExposures(day, catalog.groups);
    assert.equal(day.segmentEnds.at(-1), exposures.length);
    assert.ok(day.segmentEnds.every((end, index) => Number.isInteger(end) && end > (day.segmentEnds[index - 1] ?? 0)));
    const groupSegments = new Map();
    exposures.forEach((item, index) => {
      const segment = day.segmentEnds.findIndex(end => index < end);
      if (groupSegments.has(item.groupId)) assert.equal(groupSegments.get(item.groupId), segment, `pause splits ${item.groupId}`);
      else groupSegments.set(item.groupId, segment);
    });
  }
});

test("full curriculum honours every required dependency, including partner roots and repeated appearances", () => {
  const incoming = new Map(words.map(word => [word.id, []]));
  for (const dep of dependencies.filter(dep => dep.kind === "required")) incoming.get(dep.sourceWordId).push(dep.targetWordId);
  const seen = new Set(), exposures = new Set(), groups = new Set();
  for (const day of plan.filter(day => day.kind === "study")) {
    for (const id of day.groupIds) { assert.ok(!groups.has(id), "root groups stay on one day"); groups.add(id); }
    for (const item of studyExposures(day, catalog.groups)) {
      for (const prerequisite of incoming.get(item.wordId)) assert.ok(seen.has(prerequisite), `${prerequisite} must precede ${item.wordId}`);
      assert.ok(!exposures.has(item.key)); exposures.add(item.key); seen.add(item.wordId);
    }
  }
  assert.equal(seen.size, 5166);
  assert.equal(exposures.size, 5415);
  assert.equal(groups.size, 2247);
  assert.equal(plan.filter(day => day.kind === "review").length, 10);
  assert.equal(catalog.schedule.length, 30);
  assert.ok(catalog.schedule.every(day => day.appearanceCount >= 165 && day.appearanceCount <= 205));
});

test("root recaps keep their cross-reference while actual mnemonic base words remain required", () => {
  const ids = new Map(words.map(word => [word.spelling, word.id]));
  const dependency = (from, to) => dependencies.find(dep => dep.targetWordId === ids.get(from) && dep.sourceWordId === ids.get(to));
  assert.equal(dependency("affect", "effect").kind, "reference");
  assert.equal(dependency("effect", "affect").kind, "required");
  assert.equal(dependency("car", "caravan").kind, "required");
  assert.equal(dependency("van", "caravan").kind, "required");
  for (const word of words) {
    const detail = JSON.parse(fs.readFileSync(`data/words/${word.id}.json`, "utf8"));
    assert.equal(detail.memoryMarkup, word.memoryMarkup, `original mnemonic: ${word.spelling}`);
    assert.equal(detail.etymologyMarkup, word.etymologyMarkup);
  }
});

test("single words and multiword groups are interleaved from day one without exhausting either type early", () => {
  let run = 0, max = 0;
  for (const group of catalog.groups) { run = group.wordCount === 1 ? run + 1 : 0; max = Math.max(run, max); }
  assert.ok(max <= 4, `longest single-word run: ${max}`);
  const groups = new Map(catalog.groups.map(group => [group.id, group]));
  for (const day of catalog.schedule) {
    assert.ok(day.groupIds.filter(id => groups.get(id).wordCount > 1).length >= 15);
    assert.ok(day.groupIds.filter(id => groups.get(id).wordCount === 1).length >= 20);
  }
  assert.ok(catalog.schedule[0].groupIds.filter(id => groups.get(id).wordCount > 1).length >= 30);
});

test("runtime applies the identical compiled plan to an older remote catalog without changing word content or API version", () => {
  const remote = { ...catalog, dataVersion: "old-api-version", groups: catalog.groups.toReversed(), schedule: [] };
  const next = applyCurriculum(remote);
  assert.deepEqual(next.groups, catalog.groups);
  assert.deepEqual(next.schedule, catalog.schedule);
  assert.equal(next.dataVersion, remote.dataVersion);
  assert.equal(next.words, remote.words);
  assert.equal(next.groups[0].memoryMethod, remote.groups.at(-1).memoryMethod);
  assert.throws(() => applyCurriculum({ ...remote, groups: remote.groups.slice(1) }), /词书分组已更新/);
});

test("scheduling is deterministic even when the input group order changes", () => {
  const scheduled = buildLearningSchedule(catalog.groups.toReversed(), words, dependencies);
  assert.deepEqual(scheduled.groups, catalog.groups);
  assert.deepEqual(scheduled.schedule, catalog.schedule);
});

test("an actual word dependency cycle fails the build instead of silently skipping prerequisites", () => {
  const source = ["a", "b", "c"].map((id, index) => ({ id, spelling: id, originalOrder: index }));
  const groups = source.map(word => ({ id: `solo:${word.id}`, wordIds: [word.id], wordCount: 1, firstOrder: word.originalOrder }));
  assert.throws(() => buildLearningSchedule(groups, source, [
    { sourceWordId: "a", targetWordId: "b", kind: "required" },
    { sourceWordId: "b", targetWordId: "a", kind: "required" },
  ]), /Conflicting required word dependencies/);
});
