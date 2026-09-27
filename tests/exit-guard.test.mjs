import assert from "node:assert/strict";
import test from "node:test";
import { createExitGuard } from "../electron/exit-guard.cjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const action of ["close", "install"]) test(`${action} waits for both renderer save and native disk queue; repeated requests share gate`, async () => {
  const renderer = deferred(), disk = deferred(), performed = [];
  let drains = 0, releases = 0;
  const guard = createExitGuard({ prepare: () => renderer.promise, drain: () => { drains++; return disk.promise; }, warn: assert.fail, confirmPending: assert.fail, release: () => { releases++; }, perform: value => performed.push(value) });
  const result = guard.request(action);
  assert.equal(guard.request(action), result);
  await new Promise(setImmediate);
  assert.equal(drains, 0);
  renderer.resolve({ localSaved: true, cloudSynced: true });
  await new Promise(setImmediate);
  assert.equal(drains, 1); assert.deepEqual(performed, []);
  disk.resolve();
  assert.equal(await result, true); assert.deepEqual(performed, [action]);
  assert.equal(releases, 0, "input stays locked while native app exits");
});

test("failed local save or disk flush retains window and permits retry", async () => {
  let failure = "renderer", released = 0, performed = 0;
  const warnings = [];
  const guard = createExitGuard({ prepare: async () => ({ localSaved: failure !== "renderer", cloudSynced: true, message: "磁盘写入失败" }), drain: async () => { if (failure === "disk") throw Error("fsync failed"); }, warn: message => warnings.push(message), confirmPending: assert.fail, release: () => { released++; }, perform: () => { performed++; } });
  assert.equal(await guard.request("install"), false);
  failure = "disk";
  assert.equal(await guard.request("close"), false);
  assert.equal(performed, 0); assert.equal(released, 2);
  assert.deepEqual(warnings, ["磁盘写入失败", "fsync failed"]);
  failure = "";
  assert.equal(await guard.request("close"), true); assert.equal(performed, 1);
});

test("durable offline save may exit only after pending-cloud notice is accepted", async () => {
  let accept = false, notices = 0, performed = 0;
  const guard = createExitGuard({ prepare: async () => ({ localSaved: true, cloudSynced: false }), drain: async () => {}, warn: assert.fail, confirmPending: async () => { notices++; return accept; }, release() {}, perform: () => { performed++; } });
  assert.equal(await guard.request("close"), false); assert.equal(performed, 0);
  accept = true;
  assert.equal(await guard.request("install"), true); assert.equal(performed, 1); assert.equal(notices, 2);
});
