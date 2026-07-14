import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeInto, RESUME_SHAPES } from "../src/resume-into.js";
import { resume } from "../src/resume.js";

function packet(overrides = {}) {
  return {
    id: "a".repeat(64),
    version: 1,
    goal: "ship the parser",
    context: "must stay zero-dep",
    progress: ["wrote the validator", "added tests"],
    state: { cursor: 5, key_files: ["src/x.js"] },
    next_steps: ["wire up the CLI"],
    open_questions: ["is the offset inclusive?"],
    artifacts: [{ path: "src/x.js", note: "the parser" }],
    provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z", from_session: "s-1" },
    ...overrides,
  };
}

// --- system-prompt ---------------------------------------------------------

test("resumeInto('system-prompt') → a string opening with the resuming preamble", () => {
  const out = resumeInto(packet(), "system-prompt");
  assert.equal(typeof out, "string");
  assert.match(out, /^You are resuming an in-progress task\./);
});

test("resumeInto('system-prompt') embeds the real resume() briefing as its body", () => {
  const p = packet();
  const out = resumeInto(p, "system-prompt");
  assert.ok(out.endsWith(resume(p)));
  // The goal and section headings carry through from the briefing.
  assert.ok(out.includes("# Resuming: ship the parser"));
  assert.ok(out.includes("## Next steps"));
  assert.ok(out.includes("wire up the CLI"));
});

// --- user-turn -------------------------------------------------------------

test("resumeInto('user-turn') → a first-user-message string carrying the briefing", () => {
  const p = packet();
  const out = resumeInto(p, "user-turn");
  assert.equal(typeof out, "string");
  assert.match(out, /^You are resuming an in-progress task\./);
  assert.ok(out.endsWith(resume(p)));
  assert.ok(out.includes("must stay zero-dep"));
});

// --- mcp-resource ----------------------------------------------------------

test("resumeInto('mcp-resource') → { uri, mimeType, text } with the briefing as text", () => {
  const p = packet();
  const res = resumeInto(p, "mcp-resource");
  assert.equal(typeof res, "object");
  assert.equal(res.mimeType, "text/markdown");
  assert.equal(res.uri, `handover://packet/${p.id}`);
  assert.equal(res.text, resume(p));
  assert.ok(res.text.includes("# Resuming: ship the parser"));
});

test("resumeInto('mcp-resource') falls back to a 'draft' uri when the packet has no id", () => {
  const res = resumeInto({ goal: "g", provenance: { handed_off_by: "c", created: "2026-07-11T12:00:00Z" } }, "mcp-resource");
  assert.equal(res.uri, "handover://packet/draft");
});

// --- shapes / errors -------------------------------------------------------

test("RESUME_SHAPES lists exactly the three supported shapes", () => {
  assert.deepEqual(RESUME_SHAPES, ["system-prompt", "user-turn", "mcp-resource"]);
});

test("resumeInto on an unknown harness throws, listing the supported shapes", () => {
  assert.throws(
    () => resumeInto(packet(), "telepathy"),
    (e) => e instanceof Error && /unknown harness/.test(e.message) && /system-prompt/.test(e.message) && /mcp-resource/.test(e.message)
  );
});

test("resumeInto is deterministic — same packet + shape yields identical output", () => {
  const p = packet();
  for (const shape of RESUME_SHAPES) {
    assert.deepEqual(resumeInto(p, shape), resumeInto(p, shape));
  }
});

test("resumeInto tolerates a sparse packet in every shape (delegates to resume's placeholders)", () => {
  const sparse = { goal: "just a goal" };
  assert.match(resumeInto(sparse, "system-prompt"), /# Resuming: just a goal/);
  assert.match(resumeInto(sparse, "user-turn"), /# Resuming: just a goal/);
  assert.match(resumeInto(sparse, "mcp-resource").text, /# Resuming: just a goal/);
});
