import { test } from "node:test";
import assert from "node:assert/strict";
import { resume, summarize } from "../src/resume.js";

function packet(overrides = {}) {
  return {
    version: 1,
    goal: "ship the parser",
    context: "must stay zero-dep",
    progress: ["wrote the validator", "added tests"],
    state: { cursor: 5, key_files: ["src/x.js", "src/y.js"] },
    next_steps: ["wire up the CLI"],
    open_questions: ["is the offset inclusive?"],
    artifacts: [{ path: "src/x.js", hash: "a".repeat(64), note: "the parser" }],
    provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z", from_session: "s-1" },
    ...overrides,
  };
}

// --- resume ----------------------------------------------------------------

test("resume opens with '# Resuming: <goal>'", () => {
  assert.ok(resume(packet()).startsWith("# Resuming: ship the parser"));
});

test("resume renders every section heading in reading order", () => {
  const md = resume(packet());
  const headings = ["## Context", "## What's done", "## Current state", "## Next steps", "## Open questions", "## Artifacts"];
  let last = -1;
  for (const h of headings) {
    const at = md.indexOf(h);
    assert.ok(at > -1, `missing ${h}`);
    assert.ok(at > last, `${h} out of order`);
    last = at;
  }
});

test("resume includes the content of each section", () => {
  const md = resume(packet());
  assert.ok(md.includes("must stay zero-dep"));
  assert.ok(md.includes("- wrote the validator"));
  assert.ok(md.includes("- wire up the CLI"));
  assert.ok(md.includes("is the offset inclusive?"));
  assert.ok(md.includes("`src/x.js`"));
});

test("resume renders state as a JSON block excluding key_files, and lists key files separately", () => {
  const md = resume(packet());
  assert.ok(md.includes('"cursor": 5'));
  assert.ok(md.includes("**Key files:**"));
  assert.ok(md.includes("`src/y.js`"));
  // key_files should not appear inside the state JSON block.
  const stateBlock = md.slice(md.indexOf("## Current state"), md.indexOf("## Next steps"));
  assert.ok(!stateBlock.includes("key_files"));
});

test("resume shows an artifact with its short hash and note", () => {
  const md = resume(packet());
  assert.ok(md.includes("`src/x.js`"));
  assert.ok(md.includes("(`aaaaaaaa`)"));
  assert.ok(md.includes("— the parser"));
});

test("resume footer cites who handed off, when, version and session", () => {
  const md = resume(packet());
  assert.ok(md.includes("---"));
  assert.ok(md.includes("Handed off by claude at 2026-07-11T12:00:00Z"));
  assert.ok(md.includes("v1"));
  assert.ok(md.includes("session s-1"));
});

test("absent sections render italic placeholders rather than vanishing", () => {
  const md = resume({ goal: "just a goal", provenance: { handed_off_by: "c", created: "2026-07-11T12:00:00Z" } });
  assert.ok(md.includes("_none recorded_")); // context
  assert.ok(md.includes("_nothing recorded yet_")); // progress
  assert.ok(md.includes("_no working state captured_")); // state
  assert.ok(md.includes("none — is the task complete?")); // next steps
  assert.ok(md.includes("_none listed_")); // artifacts
});

test("resume tolerates a missing goal", () => {
  const md = resume({});
  assert.ok(md.startsWith("# Resuming: (no goal recorded)"));
});

test("resume filters out non-string / blank list items", () => {
  const md = resume(packet({ progress: ["real note", "", "   ", 42] }));
  assert.ok(md.includes("- real note"));
  assert.ok(!md.includes("- 42"));
});

test("resume ends with a trailing newline", () => {
  assert.ok(resume(packet()).endsWith("\n"));
});

test("resume never throws on garbage input", () => {
  for (const bad of [null, undefined, 42, "x", []]) {
    assert.ok(typeof resume(bad) === "string");
  }
});

// --- summarize -------------------------------------------------------------

test("summarize is a one-line '<goal> — N done, M next, K open'", () => {
  assert.equal(summarize(packet()), "ship the parser — 2 done, 1 next, 1 open");
});

test("summarize counts empty sections as zero", () => {
  assert.equal(
    summarize({ goal: "g", provenance: {} }),
    "g — 0 done, 0 next, 0 open"
  );
});

test("summarize falls back to '(no goal)' and never throws", () => {
  assert.equal(summarize({}), "(no goal) — 0 done, 0 next, 0 open");
  for (const bad of [null, undefined, 42, []]) {
    assert.ok(typeof summarize(bad) === "string");
  }
});
