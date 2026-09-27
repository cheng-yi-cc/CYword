import assert from "node:assert/strict";
import test from "node:test";
import { encodeProgress, decodeProgress } from "../src/progress-codec.ts";
import { encodeProgressWire, decodeProgressWire } from "../src/progress-compression.ts";
import { emptyProgress, rateSearchWord } from "../src/progress.ts";

test("dictionary and compressed transport preserve exact values, including token-like literals", async () => {
  const progress = { ...rateSearchWord(emptyProgress(), "test-id", "unclear"), custom: { "~0": ["~0", "~~literal", "test-id"] } };
  assert.deepEqual(decodeProgress(encodeProgress(progress)), progress);
  assert.deepEqual(await decodeProgressWire(await encodeProgressWire(progress)), progress);
});
test("malformed dictionaries, aliases, unsupported encodings and oversized compressed bodies fail closed", async () => {
  for (const value of [
    { encoding: "other", ids: [], data: {} },
    { encoding: "cyword-ids-v1", ids: ["a", "a"], data: {} },
    { encoding: "cyword-ids-v1", ids: ["a"], data: "~1" },
    { encoding: "cyword-ids-v1", ids: ["a"], data: { "~0": 1, a: 2 } },
    { encoding: "cyword-ids-v1", ids: ["__proto__"], data: {} },
    { encoding: "cyword-gzip-v1", data: "A".repeat(2_400_001) },
  ]) await assert.rejects(decodeProgressWire(value));
});
