import assert from "node:assert/strict";
import test from "node:test";
import { sessionExpiresAt } from "../src/auth-session.ts";

test("expiry uses JWT seconds and leaves opaque development tokens undated", () => {
  const token = (payload: unknown) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  assert.equal(sessionExpiresAt(token({ exp: 1_800_000_000 })), 1_800_000_000_000);
  assert.equal(sessionExpiresAt(token({ exp: 1 })), 1000);
  for (const value of ["fixture", "not.a.jwt", token({}), token({ exp: "123" })]) assert.equal(sessionExpiresAt(value), null);
});
