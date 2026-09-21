import assert from "node:assert/strict";
import test from "node:test";
import { PronunciationPlayer } from "../src/audio.ts";

class FakeAudio extends EventTarget {
  paused = false;
  reject = false;
  pending?: Promise<void>;
  play() { return this.pending ?? (this.reject ? Promise.reject(new Error("offline")) : Promise.resolve()); }
  pause() { this.paused = true; }
}

test("new playback stops old audio; late failure cannot erase the new state", async () => {
  let reject!: (reason: Error) => void;
  const old = new FakeAudio(), next = new FakeAudio();
  old.pending = new Promise((_, fail) => { reject = fail; });
  const player = new PronunciationPlayer(url => url === "old" ? old : next);
  const first = player.play("old");
  await player.play("next");
  assert.equal(old.paused, true);
  reject(new Error("late")); await first;
  assert.equal(player.snapshot().url, "next");
  assert.equal(player.snapshot().status, "playing");
  next.dispatchEvent(new Event("ended"));
  assert.equal(player.snapshot().status, "idle");
});

test("failed audio is visible and retry succeeds; closing stops current audio", async () => {
  const audio = new FakeAudio(); audio.reject = true;
  const player = new PronunciationPlayer(() => audio);
  await player.play("word");
  assert.equal(player.snapshot().status, "error");
  assert.match(player.snapshot().message, /重试/);
  audio.reject = false; await player.play("word");
  assert.equal(player.snapshot().status, "playing");
  player.stop();
  assert.equal(audio.paused, true);
  assert.equal(player.snapshot().status, "idle");
});

test("stopped pending playback cannot corrupt a replay of the same URL", async () => {
  let reject!: (reason: Error) => void;
  const old = new FakeAudio(), replay = new FakeAudio();
  old.pending = new Promise((_, fail) => { reject = fail; });
  const instances = [old, replay];
  const player = new PronunciationPlayer(() => instances.shift()!);

  const pending = player.play("same-word");
  player.stop();
  await player.play("same-word");
  assert.equal(old.paused, true);
  assert.equal(replay.paused, false);

  reject(new Error("stopped play rejected late"));
  await pending;
  assert.equal(player.snapshot().status, "playing");
  old.dispatchEvent(new Event("ended"));
  assert.equal(player.snapshot().status, "playing");
  old.dispatchEvent(new Event("error"));
  assert.deepEqual(player.snapshot(), { url: "same-word", status: "playing", message: "" });
  assert.equal(replay.paused, false);

  replay.dispatchEvent(new Event("error"));
  assert.equal(player.snapshot().status, "error");
  assert.equal(replay.paused, true);
});

test("closing or switching words while disk audio resolves cannot start stale playback", async () => {
  let resolve!: (url: string) => void;
  const played: string[] = [];
  const player = new PronunciationPlayer(url => { played.push(url); return new FakeAudio(); }, url => url === "old" ? new Promise(done => { resolve = done; }) : Promise.resolve("blob:new"));
  const pending = player.play("old");
  assert.deepEqual(player.snapshot(), { url: "old", status: "loading", message: "" });
  player.stop(); await player.play("new"); resolve("blob:old"); await pending;
  assert.deepEqual(played, ["blob:new"]); assert.equal(player.snapshot().url, "new");
});
