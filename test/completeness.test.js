import { test } from "node:test";
import assert from "node:assert/strict";
import { completeness } from "../src/completeness.js";

function report(overrides = {}) {
  return completeness({
    goal: "ship the parser",
    context: "background",
    progress: ["wrote validator"],
    state: { cursor: 5 },
    next_steps: ["wire CLI"],
    open_questions: ["q?"],
    artifacts: [{ path: "src/x.js" }],
    ...overrides,
  });
}

test("an empty packet scores 0 with all seven sections missing", () => {
  const r = completeness({});
  assert.equal(r.total, 7);
  assert.equal(r.score, 0);
  assert.deepEqual(r.present, []);
  assert.equal(r.missing.length, 7);
});

test("a fully-populated packet scores 1.0 with no warnings", () => {
  const r = report();
  assert.equal(r.score, 1);
  assert.equal(r.present.length, 7);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
});

test("score is present/total", () => {
  // goal + context present, everything else empty → 2/7.
  const r = completeness({ goal: "g", context: "c" });
  assert.equal(r.present.length, 2);
  assert.equal(r.score, 2 / 7);
});

test("blank / whitespace goal & context do not count as present", () => {
  const r = completeness({ goal: "   ", context: "" });
  assert.ok(!r.present.includes("goal"));
  assert.ok(!r.present.includes("context"));
});

test("empty arrays and empty state do not count as present", () => {
  const r = completeness({ progress: [], next_steps: [], open_questions: [], artifacts: [], state: {} });
  assert.deepEqual(r.present, []);
});

test("state counts as present only with at least one key", () => {
  assert.ok(completeness({ state: { a: 1 } }).present.includes("state"));
  assert.ok(!completeness({ state: {} }).present.includes("state"));
});

test("warning fires for no next steps", () => {
  const r = report({ next_steps: [] });
  assert.ok(r.warnings.some((w) => /no next steps/.test(w)));
});

test("warning fires for progress recorded but no artifacts listed", () => {
  const r = report({ progress: ["did work"], artifacts: [] });
  assert.ok(r.warnings.some((w) => /no artifacts listed/.test(w)));
});

test("warning fires for no working state captured", () => {
  const r = report({ state: {} });
  assert.ok(r.warnings.some((w) => /no working state captured/.test(w)));
});

test("warning fires for a path mentioned in progress but absent from artifacts / key_files", () => {
  const r = report({ progress: ["edited src/router.js"], artifacts: [{ path: "src/other.js" }] });
  assert.ok(r.warnings.some((w) => /src\/router\.js/.test(w)));
});

test("a path mentioned in progress that IS an artifact is not flagged", () => {
  const r = report({ progress: ["edited src/router.js"], artifacts: [{ path: "src/router.js" }] });
  assert.ok(!r.warnings.some((w) => /src\/router\.js/.test(w)));
});

test("a path mentioned in progress that is in state.key_files is not flagged", () => {
  const r = report({
    progress: ["edited src/router.js"],
    artifacts: [{ path: "src/x.js" }],
    state: { key_files: ["src/router.js"] },
  });
  assert.ok(!r.warnings.some((w) => /src\/router\.js is not/.test(w)));
});

test("warnings are capped for readability", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(`touched src/file${i}.js`);
  const r = report({ progress: many, artifacts: [] });
  assert.ok(r.warnings.length <= 8);
});

test("completeness never throws on garbage input", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    const r = completeness(bad);
    assert.equal(r.total, 7);
    assert.equal(r.score, 0);
  }
});
