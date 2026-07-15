import { test } from "node:test";
import assert from "node:assert/strict";
import { diffPackets } from "../src/diff.js";

function packet(overrides = {}) {
  return {
    version: 1,
    goal: "ship the parser",
    progress: ["a"],
    state: { cursor: 1 },
    next_steps: ["x"],
    open_questions: ["q1"],
    artifacts: [{ path: "f1" }],
    ...overrides,
  };
}

test("no change → all-empty diff, version_delta 0, goal_changed false", () => {
  const d = diffPackets(packet(), packet());
  assert.equal(d.goal_changed, false);
  assert.equal(d.version_delta, 0);
  assert.deepEqual(d.progress_added, []);
  assert.deepEqual(d.progress_removed, []);
  assert.deepEqual(d.next_steps_added, []);
  assert.deepEqual(d.next_steps_removed, []);
  assert.deepEqual(d.questions_opened, []);
  assert.deepEqual(d.questions_closed, []);
  assert.deepEqual(d.artifacts_added, []);
  assert.deepEqual(d.artifacts_removed, []);
  assert.deepEqual(d.state_keys_changed, []);
});

test("goal_changed flips when the goal differs", () => {
  assert.equal(diffPackets(packet(), packet({ goal: "new goal" })).goal_changed, true);
});

test("version_delta is b.version - a.version (can be negative)", () => {
  assert.equal(diffPackets(packet({ version: 1 }), packet({ version: 4 })).version_delta, 3);
  assert.equal(diffPackets(packet({ version: 4 }), packet({ version: 1 })).version_delta, -3);
});

test("progress added / removed", () => {
  const d = diffPackets(packet({ progress: ["a", "b"] }), packet({ progress: ["b", "c"] }));
  assert.deepEqual(d.progress_added, ["c"]);
  assert.deepEqual(d.progress_removed, ["a"]);
});

test("next_steps added / removed", () => {
  const d = diffPackets(packet({ next_steps: ["x"] }), packet({ next_steps: ["y", "z"] }));
  assert.deepEqual(d.next_steps_added, ["y", "z"]);
  assert.deepEqual(d.next_steps_removed, ["x"]);
});

test("questions opened / closed", () => {
  const d = diffPackets(packet({ open_questions: ["q1", "q2"] }), packet({ open_questions: ["q2", "q3"] }));
  assert.deepEqual(d.questions_opened, ["q3"]);
  assert.deepEqual(d.questions_closed, ["q1"]);
});

test("artifacts added / removed keyed by path (re-noting the same path is not churn)", () => {
  const a = packet({ artifacts: [{ path: "f1", note: "old" }] });
  const b = packet({ artifacts: [{ path: "f1", note: "new" }, { path: "f2" }] });
  const d = diffPackets(a, b);
  assert.deepEqual(d.artifacts_added, ["f2"]);
  assert.deepEqual(d.artifacts_removed, []);
});

test("set semantics: reordering the same items reads as no change", () => {
  const d = diffPackets(packet({ progress: ["a", "b", "c"] }), packet({ progress: ["c", "a", "b"] }));
  assert.deepEqual(d.progress_added, []);
  assert.deepEqual(d.progress_removed, []);
});

test("set semantics dedup duplicated entries", () => {
  const d = diffPackets(packet({ progress: ["a"] }), packet({ progress: ["b", "b", "b"] }));
  assert.deepEqual(d.progress_added, ["b"]);
});

test("state_keys_changed lists added, removed and value-changed keys, sorted, including key_files", () => {
  const a = packet({ state: { cursor: 1, mode: "a", key_files: ["x.js"] } });
  const b = packet({ state: { cursor: 2, phase: "z", key_files: ["y.js"] } });
  const d = diffPackets(a, b);
  // cursor changed value, mode removed, phase added; key_files changed value too
  // (previously key_files was silently excluded, hiding the change).
  assert.deepEqual(d.state_keys_changed, ["cursor", "key_files", "mode", "phase"]);
});

test("state_keys_changed ignores a same-valued key", () => {
  const d = diffPackets(packet({ state: { cursor: 1 } }), packet({ state: { cursor: 1 } }));
  assert.deepEqual(d.state_keys_changed, []);
});

test("diff is total: garbage inputs yield an all-empty diff", () => {
  const d = diffPackets(null, undefined);
  assert.equal(d.goal_changed, false);
  assert.equal(d.version_delta, 0);
  assert.deepEqual(d.progress_added, []);
  assert.deepEqual(d.state_keys_changed, []);
});

test("non-string array members are ignored", () => {
  const d = diffPackets(packet({ progress: ["a"] }), packet({ progress: ["a", 5, {}] }));
  assert.deepEqual(d.progress_added, []);
});
