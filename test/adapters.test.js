import { test } from "node:test";
import assert from "node:assert/strict";
import { fromClaudeCode } from "../src/adapters/claude-code.js";
import { ADAPTERS, getAdapter } from "../src/adapters/index.js";

// One JSONL transcript line for a role, content as a plain string.
function line(role, text) {
  return JSON.stringify({ type: role, message: { role, content: text } });
}
// A line whose content is an array of typed blocks.
function blockLine(role, blocks) {
  return JSON.stringify({ type: role, message: { role, content: blocks } });
}

test("fromClaudeCode: goal ← latest user message, context ← last assistant turn", () => {
  const jsonl = [
    line("user", "help me add OAuth"),
    line("assistant", "Sure, here's the plan."),
    line("user", "actually, use PKCE"),
    line("assistant", "Understood — switching to PKCE."),
  ].join("\n");
  const draft = fromClaudeCode(jsonl);
  assert.equal(draft.goal, "actually, use PKCE");
  assert.equal(draft.context, "Understood — switching to PKCE.");
});

test("fromClaudeCode: progress ← assistant bullet/numbered lines, deduped, order preserved", () => {
  const jsonl = [
    line("user", "do it"),
    line("assistant", "Progress:\n- wrote the parser\n- added tests\n1. wired the CLI"),
    line("assistant", "- added tests\n* fixed a bug"),
  ].join("\n");
  const draft = fromClaudeCode(jsonl);
  assert.deepEqual(draft.progress, ["wrote the parser", "added tests", "wired the CLI", "fixed a bug"]);
});

test("fromClaudeCode returns a PARTIAL draft: no id, no created, empty inferable-only sections", () => {
  const draft = fromClaudeCode(line("user", "goal") + "\n" + line("assistant", "ctx"));
  assert.ok(!("id" in draft));
  assert.ok(!("created" in draft));
  assert.deepEqual(draft.state, {});
  assert.deepEqual(draft.next_steps, []);
  assert.deepEqual(draft.open_questions, []);
  assert.deepEqual(draft.artifacts, []);
});

test("fromClaudeCode extracts text from typed content blocks, ignoring non-text blocks", () => {
  const jsonl = [
    blockLine("user", [{ type: "text", text: "the ask" }]),
    blockLine("assistant", [
      { type: "tool_use", name: "Bash", input: {} },
      { type: "text", text: "- did a thing" },
      { type: "thinking", thinking: "hmm" },
    ]),
  ].join("\n");
  const draft = fromClaudeCode(jsonl);
  assert.equal(draft.goal, "the ask");
  assert.equal(draft.context, "- did a thing");
  assert.deepEqual(draft.progress, ["did a thing"]);
});

test("fromClaudeCode tolerates malformed / blank / non-message lines (skips, never throws)", () => {
  const jsonl = [
    "not json at all",
    "",
    "   ",
    JSON.stringify({ type: "summary", foo: 1 }), // no text
    line("user", "the real goal"),
    "{ half a json line",
    line("assistant", "the real context"),
  ].join("\n");
  const draft = fromClaudeCode(jsonl);
  assert.equal(draft.goal, "the real goal");
  assert.equal(draft.context, "the real context");
});

test("fromClaudeCode on an empty / nullish transcript → empty draft", () => {
  for (const bad of ["", null, undefined]) {
    const draft = fromClaudeCode(bad);
    assert.equal(draft.goal, "");
    assert.equal(draft.context, "");
    assert.deepEqual(draft.progress, []);
  }
});

test("fromClaudeCode seeds agent / from_session only when passed", () => {
  const jsonl = line("user", "g");
  const withOpts = fromClaudeCode(jsonl, { agent: "claude", from_session: "s-7" });
  assert.equal(withOpts.agent, "claude");
  assert.equal(withOpts.from_session, "s-7");
  const without = fromClaudeCode(jsonl);
  assert.ok(!("agent" in without));
  assert.ok(!("from_session" in without));
});

test("fromClaudeCode caps inferred progress at max_progress (keeps the last N)", () => {
  const bullets = [];
  for (let i = 0; i < 20; i++) bullets.push(`- step ${i}`);
  const jsonl = [line("user", "g"), line("assistant", bullets.join("\n"))].join("\n");
  const draft = fromClaudeCode(jsonl, { max_progress: 5 });
  assert.equal(draft.progress.length, 5);
  assert.deepEqual(draft.progress, ["step 15", "step 16", "step 17", "step 18", "step 19"]);
});

test("adapter registry: ADAPTERS['claude-code'] is fromClaudeCode; getAdapter resolves it", () => {
  assert.equal(ADAPTERS["claude-code"], fromClaudeCode);
  assert.equal(getAdapter("claude-code"), fromClaudeCode);
});

test("getAdapter returns null for an unknown harness", () => {
  assert.equal(getAdapter("does-not-exist"), null);
  assert.equal(getAdapter("hasOwnProperty"), null); // not fooled by prototype keys
});
