import test from "node:test";
import assert from "node:assert/strict";
import { completedSegmentEnd } from "../src/study-segments.ts";

const exposures = Array.from({ length: 9 }, (_, index) => ({ key: `group:${index}` }));
const rated = (...indices: number[]) => new Set(indices.map(index => exposures[index].key));

test("rest only after a complete dependency segment, including an already-rated prefix", () => {
  assert.equal(completedSegmentEnd([3, 7, 9], 2, 3, exposures, rated(0, 1, 2)), 3);
  assert.equal(completedSegmentEnd([3, 7, 9], 5, 7, exposures, rated(3, 4, 5, 6)), 7);
});

test("do not split unfinished units or rest while returning to an earlier pending word", () => {
  assert.equal(completedSegmentEnd([3, 7, 9], 4, 5, exposures, rated(3, 4)), null);
  assert.equal(completedSegmentEnd([3, 7, 9], 6, 7, exposures, rated(3, 4, 6)), null);
  assert.equal(completedSegmentEnd([3, 7, 9], 6, 1, exposures, rated(3, 4, 5, 6)), null);
});

test("skipping already-rated segments reaches the next pending word without inventing completion", () => {
  assert.equal(completedSegmentEnd([3, 7, 9], 2, 8, exposures, rated(0, 1, 2, 3, 4, 5, 6, 7)), 3);
});

test("the final segment and old catalogs do not insert a misleading day-complete rest screen", () => {
  assert.equal(completedSegmentEnd([3, 7, 9], 8, -1, exposures, rated(7, 8)), null);
  assert.equal(completedSegmentEnd(undefined, 2, 3, exposures, rated(0, 1, 2)), null);
});
