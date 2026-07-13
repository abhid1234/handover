import { test } from "node:test";
import assert from "node:assert/strict";
import { pack, revise } from "../src/pack.js";
import { canonicalize, computeId, computeHash } from "../src/id.js";
import { validatePacket } from "../src/schema.js";

const CREATED = "2026-07-11T12:00:00Z";
const CREATED2 = "2026-07-11T13:30:00Z";

function baseInput(overrides = {}) {
  return { goal: "ship the parser", agent: "claude-opus-4-8/claude-code", created: CREATED, ...overrides };
}

// --- canonicalize / computeId / computeHash --------------------------------

test("canonicalize sorts keys and excludes id, recursively", () => {
  const a = canonicalize({ id: "ignored", b: 2, a: 1, nested: { y: 2, x: 1 } });
  const b = canonicalize({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
  assert.equal(a, b);
  assert.ok(!a.includes("ignored"));
});

test("computeId is a 64-hex sha256 digest", () => {
  const id = computeId({ goal: "x", provenance: {} });
  assert.equal(id.length, 64);
  assert.match(id, /^[0-9a-f]{64}$/);
});

test("computeId is deterministic and order-independent (key order can't perturb it)", () => {
  assert.equal(computeId({ a: 1, b: 2 }), computeId({ b: 2, a: 1 }));
  assert.equal(
    computeId({ goal: "g", state: { a: 1, b: 2 } }),
    computeId({ state: { b: 2, a: 1 }, goal: "g" })
  );
});

test("computeId excludes the id field (a record and its id-stamped self hash equal)", () => {
  const body = { goal: "g", version: 1 };
  const id = computeId(body);
  assert.equal(computeId({ id, ...body }), id);
  assert.equal(computeId({ id: "totally-different", ...body }), id);
});

test("computeId changes when any content changes", () => {
  const a = computeId({ goal: "g", progress: ["a"] });
  const b = computeId({ goal: "g", progress: ["a", "b"] });
  assert.notEqual(a, b);
});

test("computeHash matches sha256 of the string / Buffer content", () => {
  // Well-known sha256("hello world").
  assert.equal(computeHash("hello world"), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  assert.equal(computeHash(Buffer.from("hello world")), computeHash("hello world"));
});

// --- pack: happy path + defaults -------------------------------------------

test("pack builds a valid packet with a content-hash id and version 1", () => {
  const p = pack(baseInput());
  assert.equal(validatePacket(p).valid, true);
  assert.match(p.id, /^[0-9a-f]{64}$/);
  assert.equal(p.version, 1);
  assert.equal(p.goal, "ship the parser");
});

test("pack applies defaults to every optional section", () => {
  const p = pack(baseInput());
  assert.equal(p.context, "");
  assert.deepEqual(p.progress, []);
  assert.deepEqual(p.state, {});
  assert.deepEqual(p.next_steps, []);
  assert.deepEqual(p.open_questions, []);
  assert.deepEqual(p.artifacts, []);
});

test("pack stamps the agent + created into provenance.handed_off_by / created", () => {
  const p = pack(baseInput());
  assert.deepEqual(p.provenance, { handed_off_by: "claude-opus-4-8/claude-code", created: CREATED });
});

test("pack includes from_session in provenance only when provided", () => {
  const withSession = pack(baseInput({ from_session: "s-99" }));
  assert.equal(withSession.provenance.from_session, "s-99");
  const without = pack(baseInput());
  assert.ok(!("from_session" in without.provenance));
});

test("pack carries through the rich sections", () => {
  const p = pack(
    baseInput({
      context: "constraints",
      progress: ["did a"],
      state: { cursor: 5, key_files: ["src/x.js"] },
      next_steps: ["do b"],
      open_questions: ["q?"],
      artifacts: [{ path: "src/x.js", note: "n" }],
      version: 3,
    })
  );
  assert.equal(p.context, "constraints");
  assert.deepEqual(p.progress, ["did a"]);
  assert.equal(p.state.cursor, 5);
  assert.deepEqual(p.next_steps, ["do b"]);
  assert.deepEqual(p.open_questions, ["q?"]);
  assert.deepEqual(p.artifacts, [{ path: "src/x.js", note: "n" }]);
  assert.equal(p.version, 3);
});

test("pack is pure over its inputs — same inputs, same id", () => {
  assert.equal(pack(baseInput()).id, pack(baseInput()).id);
});

test("pack does not mutate or alias the caller's arrays/objects", () => {
  const progress = ["a"];
  const state = { cursor: 1 };
  const artifacts = [{ path: "x" }];
  const p = pack(baseInput({ progress, state, artifacts }));
  progress.push("b");
  state.cursor = 99;
  artifacts[0].path = "mutated";
  assert.deepEqual(p.progress, ["a"]);
  assert.equal(p.state.cursor, 1);
  assert.equal(p.artifacts[0].path, "x");
});

// --- pack: throws on bad input ---------------------------------------------

test("pack throws when goal is missing / empty", () => {
  assert.throws(() => pack({ agent: "c", created: CREATED }), /goal/);
  assert.throws(() => pack(baseInput({ goal: "" })), /goal/);
  assert.throws(() => pack(baseInput({ goal: "   " })), /goal/);
});

test("pack throws when agent is missing / empty", () => {
  assert.throws(() => pack({ goal: "g", created: CREATED }), /agent/);
  assert.throws(() => pack(baseInput({ agent: "" })), /agent/);
});

test("pack throws when created is missing / not ISO-8601 UTC", () => {
  assert.throws(() => pack({ goal: "g", agent: "c" }), /created/);
  assert.throws(() => pack(baseInput({ created: "nope" })), /created/);
  assert.throws(() => pack(baseInput({ created: "2026-07-11T12:00:00+00:00" })), /created/);
  assert.throws(() => pack(baseInput({ created: "2026-02-30T00:00:00Z" })), /created/);
});

test("pack throws on wrong-typed sections", () => {
  assert.throws(() => pack(baseInput({ context: 5 })), /context/);
  assert.throws(() => pack(baseInput({ progress: "x" })), /progress/);
  assert.throws(() => pack(baseInput({ next_steps: "x" })), /next_steps/);
  assert.throws(() => pack(baseInput({ open_questions: "x" })), /open_questions/);
  assert.throws(() => pack(baseInput({ artifacts: "x" })), /artifacts/);
  assert.throws(() => pack(baseInput({ state: [] })), /state/);
  assert.throws(() => pack(baseInput({ version: 0 })), /version/);
  assert.throws(() => pack(baseInput({ from_session: 5 })), /from_session/);
});

test("pack re-validates and throws with a violation detail if a bad artifact slips in", () => {
  assert.throws(() => pack(baseInput({ artifacts: [{ path: "ok", hash: "bad" }] })), /invalid packet|hash/);
});

// --- revise ----------------------------------------------------------------

test("revise increments version and computes a new id", () => {
  const p1 = pack(baseInput());
  const p2 = revise(p1, { created: CREATED2 });
  assert.equal(p2.version, p1.version + 1);
  assert.notEqual(p2.id, p1.id);
  assert.equal(validatePacket(p2).valid, true);
});

test("revise APPENDS array sections to the existing ones", () => {
  const p1 = pack(baseInput({ progress: ["a"], next_steps: ["x"], open_questions: ["q1"], artifacts: [{ path: "f1" }] }));
  const p2 = revise(p1, {
    created: CREATED2,
    progress: ["b"],
    next_steps: ["y"],
    open_questions: ["q2"],
    artifacts: [{ path: "f2" }],
  });
  assert.deepEqual(p2.progress, ["a", "b"]);
  assert.deepEqual(p2.next_steps, ["x", "y"]);
  assert.deepEqual(p2.open_questions, ["q1", "q2"]);
  assert.deepEqual(p2.artifacts.map((a) => a.path), ["f1", "f2"]);
});

test("revise REPLACES scalar sections (goal, context) when present in the patch", () => {
  const p1 = pack(baseInput({ context: "old" }));
  const p2 = revise(p1, { created: CREATED2, goal: "new goal", context: "new context" });
  assert.equal(p2.goal, "new goal");
  assert.equal(p2.context, "new context");
});

test("revise keeps prior scalars when the patch omits them", () => {
  const p1 = pack(baseInput({ goal: "keep me", context: "keep too" }));
  const p2 = revise(p1, { created: CREATED2 });
  assert.equal(p2.goal, "keep me");
  assert.equal(p2.context, "keep too");
});

test("revise shallow-merges state (patch keys win, others survive)", () => {
  const p1 = pack(baseInput({ state: { cursor: 1, mode: "a" } }));
  const p2 = revise(p1, { created: CREATED2, state: { cursor: 9, extra: true } });
  assert.deepEqual(p2.state, { cursor: 9, mode: "a", extra: true });
});

test("revise refreshes provenance.created and can switch agent / from_session", () => {
  const p1 = pack(baseInput({ from_session: "s1" }));
  const p2 = revise(p1, { created: CREATED2, agent: "codex", from_session: "s2" });
  assert.equal(p2.provenance.created, CREATED2);
  assert.equal(p2.provenance.handed_off_by, "codex");
  assert.equal(p2.provenance.from_session, "s2");
});

test("revise inherits the prior handed_off_by when patch.agent is omitted", () => {
  const p1 = pack(baseInput({ agent: "claude" }));
  const p2 = revise(p1, { created: CREATED2 });
  assert.equal(p2.provenance.handed_off_by, "claude");
});

test("revise throws when patch.created is missing / invalid (a revision is a fresh handoff)", () => {
  const p1 = pack(baseInput());
  assert.throws(() => revise(p1, {}), /created/);
  assert.throws(() => revise(p1, { created: "nope" }), /created/);
});

test("revise throws on a non-object packet / patch, and on non-array patch arrays", () => {
  assert.throws(() => revise(null, { created: CREATED2 }), /packet/);
  assert.throws(() => revise(pack(baseInput()), null), /patch/);
  assert.throws(() => revise(pack(baseInput()), { created: CREATED2, progress: "x" }), /array/);
});

test("revise throws when the resulting goal would be empty", () => {
  const p1 = pack(baseInput());
  assert.throws(() => revise(p1, { created: CREATED2, goal: "" }), /goal/);
});
