import { test } from "node:test";
import assert from "node:assert/strict";
import { fromClaudeCode } from "../src/adapters/claude-code.js";
import { fromCodex } from "../src/adapters/codex.js";
import { fromCursor } from "../src/adapters/cursor.js";
import { fromAntigravity } from "../src/adapters/antigravity.js";
import {
  ADAPTERS,
  getAdapter,
  fromClaudeCode as fromClaudeCodeIdx,
  fromCodex as fromCodexIdx,
  fromCursor as fromCursorIdx,
  fromAntigravity as fromAntigravityIdx,
} from "../src/adapters/index.js";

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

// --- fromCodex -------------------------------------------------------------

// One Codex rollout line: a response_item envelope wrapping a message payload.
function codexLine(role, content) {
  return JSON.stringify({ type: "response_item", payload: { type: "message", role, content } });
}
// A Codex block line whose content is an array of typed text blocks.
function codexBlockLine(role, blocks) {
  return JSON.stringify({ type: "response_item", payload: { type: "message", role, content: blocks } });
}

test("fromCodex: goal ← latest user message, context ← last assistant turn", () => {
  const jsonl = [
    codexLine("user", "help me add OAuth"),
    codexLine("assistant", "Sure, here's the plan."),
    codexLine("user", "actually, use PKCE"),
    codexLine("assistant", "Understood — switching to PKCE."),
  ].join("\n");
  const draft = fromCodex(jsonl);
  assert.equal(draft.goal, "actually, use PKCE");
  assert.equal(draft.context, "Understood — switching to PKCE.");
});

test("fromCodex: progress ← assistant bullet/numbered lines, deduped, order preserved", () => {
  const jsonl = [
    codexLine("user", "do it"),
    codexLine("assistant", "Progress:\n- wrote the parser\n- added tests\n1. wired the CLI"),
    codexLine("assistant", "- added tests\n* fixed a bug"),
  ].join("\n");
  const draft = fromCodex(jsonl);
  assert.deepEqual(draft.progress, ["wrote the parser", "added tests", "wired the CLI", "fixed a bug"]);
});

test("fromCodex extracts text from input_text/output_text blocks, ignoring non-text blocks", () => {
  const jsonl = [
    codexBlockLine("user", [{ type: "input_text", text: "the ask" }]),
    codexBlockLine("assistant", [
      { type: "function_call", name: "shell", arguments: "{}" },
      { type: "output_text", text: "- did a thing" },
      { type: "reasoning", text_kind: "thinking" },
    ]),
  ].join("\n");
  const draft = fromCodex(jsonl);
  assert.equal(draft.goal, "the ask");
  assert.equal(draft.context, "- did a thing");
  assert.deepEqual(draft.progress, ["did a thing"]);
});

test("fromCodex unwraps the payload envelope but also reads flat message records", () => {
  const flat = [
    JSON.stringify({ type: "message", role: "user", content: "flat goal" }),
    JSON.stringify({ type: "message", role: "assistant", content: "flat context" }),
  ].join("\n");
  const draft = fromCodex(flat);
  assert.equal(draft.goal, "flat goal");
  assert.equal(draft.context, "flat context");
});

test("fromCodex tolerates malformed / blank / non-message lines (skips, never throws)", () => {
  const jsonl = [
    "not json at all",
    "",
    "   ",
    JSON.stringify({ type: "response_item", payload: { type: "reasoning" } }), // no text
    codexLine("user", "the real goal"),
    "{ half a json line",
    codexLine("assistant", "the real context"),
  ].join("\n");
  const draft = fromCodex(jsonl);
  assert.equal(draft.goal, "the real goal");
  assert.equal(draft.context, "the real context");
});

test("fromCodex on an empty / nullish rollout → empty draft", () => {
  for (const bad of ["", null, undefined]) {
    const draft = fromCodex(bad);
    assert.equal(draft.goal, "");
    assert.equal(draft.context, "");
    assert.deepEqual(draft.progress, []);
  }
});

test("fromCodex returns a PARTIAL draft and seeds agent / from_session only when passed", () => {
  const jsonl = codexLine("user", "g");
  const draft = fromCodex(jsonl);
  assert.ok(!("id" in draft));
  assert.ok(!("created" in draft));
  assert.deepEqual(draft.state, {});
  assert.deepEqual(draft.next_steps, []);
  const withOpts = fromCodex(jsonl, { agent: "codex", from_session: "s-9" });
  assert.equal(withOpts.agent, "codex");
  assert.equal(withOpts.from_session, "s-9");
});

test("fromCodex caps inferred progress at max_progress (keeps the last N)", () => {
  const bullets = [];
  for (let i = 0; i < 20; i++) bullets.push(`- step ${i}`);
  const jsonl = [codexLine("user", "g"), codexLine("assistant", bullets.join("\n"))].join("\n");
  const draft = fromCodex(jsonl, { max_progress: 5 });
  assert.deepEqual(draft.progress, ["step 15", "step 16", "step 17", "step 18", "step 19"]);
});

// --- fromCursor ------------------------------------------------------------

test("fromCursor reads a whole-document JSON chat ({ messages: [...] })", () => {
  const doc = JSON.stringify({
    messages: [
      { role: "user", content: "help me add OAuth" },
      { role: "assistant", content: "Sure." },
      { role: "user", content: "actually, use PKCE" },
      { role: "assistant", content: "- switched to PKCE\n- wrote the verifier" },
    ],
  });
  const draft = fromCursor(doc);
  assert.equal(draft.goal, "actually, use PKCE");
  assert.equal(draft.context, "- switched to PKCE\n- wrote the verifier");
  assert.deepEqual(draft.progress, ["switched to PKCE", "wrote the verifier"]);
});

test("fromCursor reads a top-level JSON array of messages", () => {
  const doc = JSON.stringify([
    { role: "human", content: "the ask" },
    { role: "ai", content: "the answer" },
  ]);
  const draft = fromCursor(doc);
  assert.equal(draft.goal, "the ask");
  assert.equal(draft.context, "the answer");
});

test("fromCursor reads a .jsonl stream of message objects", () => {
  const jsonl = [
    JSON.stringify({ role: "user", content: "goal here" }),
    JSON.stringify({ role: "assistant", content: "- did a thing" }),
  ].join("\n");
  const draft = fromCursor(jsonl);
  assert.equal(draft.goal, "goal here");
  assert.deepEqual(draft.progress, ["did a thing"]);
});

test("fromCursor reads a User:/Assistant: prose transcript", () => {
  const prose = [
    "User: add OAuth",
    "Assistant: on it",
    "- wrote the parser",
    "User: use PKCE",
    "Assistant: switching now",
  ].join("\n");
  const draft = fromCursor(prose);
  assert.equal(draft.goal, "use PKCE");
  assert.equal(draft.context, "switching now");
  assert.deepEqual(draft.progress, ["wrote the parser"]);
});

test("fromCursor reads a marker-less scratchpad (heading → goal, bullets → progress)", () => {
  const scratch = ["# Add OAuth to login", "Some background prose.", "- wrote the parser", "- added tests"].join("\n");
  const draft = fromCursor(scratch);
  assert.equal(draft.goal, "Add OAuth to login");
  assert.deepEqual(draft.progress, ["wrote the parser", "added tests"]);
});

test("fromCursor tolerates malformed lines and empty input (skips, never throws)", () => {
  const jsonl = ["not json", "", "  ", JSON.stringify({ role: "user", content: "real goal" }), "{ half"].join("\n");
  const draft = fromCursor(jsonl);
  assert.equal(draft.goal, "real goal");
  for (const bad of ["", null, undefined]) {
    const d = fromCursor(bad);
    assert.equal(d.goal, "");
    assert.deepEqual(d.progress, []);
  }
});

test("fromCursor returns a PARTIAL draft and seeds agent / from_session only when passed", () => {
  const doc = JSON.stringify([{ role: "user", content: "g" }]);
  const draft = fromCursor(doc);
  assert.ok(!("id" in draft));
  assert.ok(!("created" in draft));
  assert.deepEqual(draft.artifacts, []);
  const withOpts = fromCursor(doc, { agent: "cursor", from_session: "s-3" });
  assert.equal(withOpts.agent, "cursor");
  assert.equal(withOpts.from_session, "s-3");
});

// --- fromAntigravity -------------------------------------------------------

test("fromAntigravity: goal ← latest user ask, context ← last assistant turn", () => {
  const doc = JSON.stringify({
    messages: [
      { role: "user", content: "help me add OAuth" },
      { role: "agent", content: "Sure." },
      { role: "user", content: "actually, use PKCE" },
      { role: "agent", content: "- switched to PKCE\n- wrote the verifier" },
    ],
  });
  const draft = fromAntigravity(doc);
  assert.equal(draft.goal, "actually, use PKCE");
  assert.equal(draft.context, "- switched to PKCE\n- wrote the verifier");
  assert.deepEqual(draft.progress, ["switched to PKCE", "wrote the verifier"]);
});

test("fromAntigravity reads a .jsonl stream and normalizes the 'agent' role to assistant", () => {
  const jsonl = [
    JSON.stringify({ role: "user", content: "the goal" }),
    JSON.stringify({ role: "agent", content: "- did a thing" }),
  ].join("\n");
  const draft = fromAntigravity(jsonl);
  assert.equal(draft.goal, "the goal");
  assert.deepEqual(draft.progress, ["did a thing"]);
});

test("fromAntigravity reads an AGENTS.md-style brief (heading → goal, bullets → progress)", () => {
  const agentsMd = [
    "# Add PKCE to the OAuth login flow",
    "The auth module must stay framework-agnostic.",
    "- wrote the verifier helpers",
    "1. wired them into /authorize",
  ].join("\n");
  const draft = fromAntigravity(agentsMd);
  assert.equal(draft.goal, "Add PKCE to the OAuth login flow");
  assert.equal(draft.context, "The auth module must stay framework-agnostic.");
  assert.deepEqual(draft.progress, ["wrote the verifier helpers", "wired them into /authorize"]);
});

test("fromAntigravity reads a User:/Assistant: prose transcript", () => {
  const prose = ["User: add OAuth", "Assistant: on it", "- wrote the parser", "User: use PKCE", "Assistant: switching"].join("\n");
  const draft = fromAntigravity(prose);
  assert.equal(draft.goal, "use PKCE");
  assert.equal(draft.context, "switching");
  assert.deepEqual(draft.progress, ["wrote the parser"]);
});

test("fromAntigravity extracts text from typed content blocks, ignoring non-text blocks", () => {
  const doc = JSON.stringify([
    { role: "user", content: [{ type: "text", text: "the ask" }] },
    { role: "agent", content: [{ type: "tool_use", name: "run" }, { type: "text", text: "- did a thing" }] },
  ]);
  const draft = fromAntigravity(doc);
  assert.equal(draft.goal, "the ask");
  assert.equal(draft.context, "- did a thing");
  assert.deepEqual(draft.progress, ["did a thing"]);
});

test("fromAntigravity tolerates malformed lines and empty input (skips, never throws)", () => {
  const jsonl = ["not json", "", "  ", JSON.stringify({ role: "user", content: "real goal" }), "{ half"].join("\n");
  const draft = fromAntigravity(jsonl);
  assert.equal(draft.goal, "real goal");
  for (const bad of ["", null, undefined]) {
    const d = fromAntigravity(bad);
    assert.equal(d.goal, "");
    assert.deepEqual(d.progress, []);
  }
});

test("fromAntigravity returns a PARTIAL draft and seeds agent / from_session only when passed", () => {
  const doc = JSON.stringify([{ role: "user", content: "g" }]);
  const draft = fromAntigravity(doc);
  assert.ok(!("id" in draft));
  assert.ok(!("created" in draft));
  assert.deepEqual(draft.next_steps, []);
  const withOpts = fromAntigravity(doc, { agent: "antigravity", from_session: "s-4" });
  assert.equal(withOpts.agent, "antigravity");
  assert.equal(withOpts.from_session, "s-4");
});

test("fromAntigravity caps inferred progress at max_progress (keeps the last N)", () => {
  const bullets = [];
  for (let i = 0; i < 20; i++) bullets.push(`- step ${i}`);
  const doc = JSON.stringify([{ role: "user", content: "g" }, { role: "agent", content: bullets.join("\n") }]);
  const draft = fromAntigravity(doc, { max_progress: 5 });
  assert.deepEqual(draft.progress, ["step 15", "step 16", "step 17", "step 18", "step 19"]);
});

// --- registry --------------------------------------------------------------

test("adapter registry resolves all four harnesses by name", () => {
  assert.equal(ADAPTERS["claude-code"], fromClaudeCode);
  assert.equal(ADAPTERS["codex"], fromCodex);
  assert.equal(ADAPTERS["cursor"], fromCursor);
  assert.equal(ADAPTERS["antigravity"], fromAntigravity);
  assert.equal(getAdapter("claude-code"), fromClaudeCode);
  assert.equal(getAdapter("codex"), fromCodex);
  assert.equal(getAdapter("cursor"), fromCursor);
  assert.equal(getAdapter("antigravity"), fromAntigravity);
});

test("adapter registry re-exports each builder from the index module", () => {
  assert.equal(fromClaudeCodeIdx, fromClaudeCode);
  assert.equal(fromCodexIdx, fromCodex);
  assert.equal(fromCursorIdx, fromCursor);
  assert.equal(fromAntigravityIdx, fromAntigravity);
});

test("getAdapter returns null for an unknown harness", () => {
  assert.equal(getAdapter("does-not-exist"), null);
  assert.equal(getAdapter("hasOwnProperty"), null); // not fooled by prototype keys
});
