import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePacket,
  validateArtifact,
  isIso8601Utc,
  isSha256Hex,
  PACKET_FIELDS,
  REQUIRED_SECTIONS,
  ERROR_CODES,
} from "../src/schema.js";

// A 64-hex sha256-shaped string, and a canonical fully-valid packet.
const HEX = "a".repeat(64);

function validPacket(overrides = {}) {
  return {
    id: HEX,
    version: 1,
    goal: "ship the parser",
    context: "background the resumer must respect",
    progress: ["wrote the validator"],
    state: { cursor: 5, key_files: ["src/x.js"] },
    next_steps: ["wire up the CLI"],
    open_questions: ["is the offset inclusive?"],
    artifacts: [{ path: "src/x.js", hash: HEX, note: "the parser" }],
    provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z" },
    ...overrides,
  };
}

function codes(result) {
  return result.errors.map((e) => e.code);
}
function codeAt(result, path) {
  return result.errors.filter((e) => e.path === path).map((e) => e.code);
}

// --- exported constants ----------------------------------------------------

test("PACKET_FIELDS is the canonical top-level field set", () => {
  assert.deepEqual(PACKET_FIELDS, [
    "id",
    "version",
    "goal",
    "context",
    "progress",
    "state",
    "next_steps",
    "open_questions",
    "artifacts",
    "provenance",
  ]);
});

test("REQUIRED_SECTIONS is the seven scored sections in reading order", () => {
  assert.deepEqual(REQUIRED_SECTIONS, [
    "goal",
    "context",
    "progress",
    "state",
    "next_steps",
    "open_questions",
    "artifacts",
  ]);
  assert.equal(REQUIRED_SECTIONS.length, 7);
});

test("ERROR_CODES exposes every stable code", () => {
  for (const code of [
    "MISSING_FIELD",
    "UNKNOWN_FIELD",
    "WRONG_TYPE",
    "NOT_OBJECT",
    "NOT_ARRAY",
    "EMPTY_STRING",
    "INVALID_INTEGER",
    "INVALID_ISO8601",
    "INVALID_SHA256",
  ]) {
    assert.equal(ERROR_CODES[code], code, `ERROR_CODES.${code}`);
  }
});

// --- isIso8601Utc ----------------------------------------------------------

test("isIso8601Utc accepts UTC …Z with and without sub-seconds", () => {
  assert.equal(isIso8601Utc("2026-07-11T12:00:00Z"), true);
  assert.equal(isIso8601Utc("2026-07-11T12:00:00.123Z"), true);
  assert.equal(isIso8601Utc("2026-07-11T12:00:00.000001Z"), true);
});

test("isIso8601Utc rejects offsets and local times", () => {
  assert.equal(isIso8601Utc("2026-07-11T12:00:00+00:00"), false);
  assert.equal(isIso8601Utc("2026-07-11T12:00:00-05:00"), false);
  assert.equal(isIso8601Utc("2026-07-11T12:00:00"), false);
  assert.equal(isIso8601Utc("2026-07-11 12:00:00Z"), false);
  assert.equal(isIso8601Utc("2026-07-11"), false);
});

test("isIso8601Utc rejects impossible calendar dates (regex-shaped but unreal)", () => {
  // Out-of-range month/day that Date.parse rejects outright.
  assert.equal(isIso8601Utc("2026-13-40T00:00:00Z"), false);
  // Roll-over dates Date.parse silently normalizes — the round-trip catches them.
  assert.equal(isIso8601Utc("2026-02-30T00:00:00Z"), false);
  assert.equal(isIso8601Utc("2026-04-31T00:00:00Z"), false);
});

test("isIso8601Utc rejects non-strings", () => {
  assert.equal(isIso8601Utc(42), false);
  assert.equal(isIso8601Utc(null), false);
  assert.equal(isIso8601Utc(undefined), false);
  assert.equal(isIso8601Utc({}), false);
});

// --- isSha256Hex -----------------------------------------------------------

test("isSha256Hex accepts exactly 64 lowercase hex chars", () => {
  assert.equal(isSha256Hex(HEX), true);
  assert.equal(isSha256Hex("0123456789abcdef".repeat(4)), true);
});

test("isSha256Hex rejects wrong length, uppercase, non-hex, non-string", () => {
  assert.equal(isSha256Hex("a".repeat(63)), false);
  assert.equal(isSha256Hex("a".repeat(65)), false);
  assert.equal(isSha256Hex("A".repeat(64)), false); // uppercase
  assert.equal(isSha256Hex("g".repeat(64)), false); // non-hex
  assert.equal(isSha256Hex(""), false);
  assert.equal(isSha256Hex(42), false);
  assert.equal(isSha256Hex(null), false);
});

// --- validatePacket: valid -------------------------------------------------

test("fully-valid packet → valid, no errors", () => {
  assert.deepEqual(validatePacket(validPacket()), { valid: true, errors: [] });
});

test("a minimal packet (only goal + provenance) is valid", () => {
  const p = { goal: "do the thing", provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z" } };
  assert.deepEqual(validatePacket(p), { valid: true, errors: [] });
});

test("optional sections may be absent", () => {
  const p = validPacket();
  delete p.id;
  delete p.version;
  delete p.context;
  delete p.progress;
  delete p.state;
  delete p.next_steps;
  delete p.open_questions;
  delete p.artifacts;
  assert.equal(validatePacket(p).valid, true);
});

test("provenance.from_session is an accepted optional field", () => {
  const p = validPacket({
    provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z", from_session: "s-42" },
  });
  assert.equal(validatePacket(p).valid, true);
});

// --- validatePacket: required fields ---------------------------------------

test("goal missing → MISSING_FIELD at goal", () => {
  const p = validPacket();
  delete p.goal;
  const result = validatePacket(p);
  assert.equal(result.valid, false);
  assert.deepEqual(codeAt(result, "goal"), ["MISSING_FIELD"]);
});

test("provenance missing → MISSING_FIELD at provenance", () => {
  const p = validPacket();
  delete p.provenance;
  const result = validatePacket(p);
  assert.equal(result.valid, false);
  assert.deepEqual(codeAt(result, "provenance"), ["MISSING_FIELD"]);
});

test("provenance.handed_off_by missing → MISSING_FIELD", () => {
  const p = validPacket({ provenance: { created: "2026-07-11T12:00:00Z" } });
  assert.deepEqual(codeAt(validatePacket(p), "provenance.handed_off_by"), ["MISSING_FIELD"]);
});

test("provenance.created missing → MISSING_FIELD", () => {
  const p = validPacket({ provenance: { handed_off_by: "claude" } });
  assert.deepEqual(codeAt(validatePacket(p), "provenance.created"), ["MISSING_FIELD"]);
});

// --- validatePacket: types & shapes ----------------------------------------

test("id must be a sha256 hex digest → INVALID_SHA256", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ id: "nope" })), "id"), ["INVALID_SHA256"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ id: "A".repeat(64) })), "id"), ["INVALID_SHA256"]);
});

test("version must be an integer >= 1 → INVALID_INTEGER", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ version: 0 })), "version"), ["INVALID_INTEGER"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ version: -1 })), "version"), ["INVALID_INTEGER"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ version: 1.5 })), "version"), ["INVALID_INTEGER"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ version: "1" })), "version"), ["INVALID_INTEGER"]);
});

test("goal wrong type / empty → WRONG_TYPE / EMPTY_STRING", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ goal: 42 })), "goal"), ["WRONG_TYPE"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ goal: "" })), "goal"), ["EMPTY_STRING"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ goal: "   " })), "goal"), ["EMPTY_STRING"]);
});

test("context must be a string → WRONG_TYPE", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ context: 42 })), "context"), ["WRONG_TYPE"]);
});

test("progress / next_steps / open_questions must be arrays of strings", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ progress: "x" })), "progress"), ["NOT_ARRAY"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ next_steps: {} })), "next_steps"), ["NOT_ARRAY"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ open_questions: 3 })), "open_questions"), ["NOT_ARRAY"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ progress: ["ok", 5] })), "progress[1]"), ["WRONG_TYPE"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ next_steps: [1] })), "next_steps[0]"), ["WRONG_TYPE"]);
});

test("state must be an object → WRONG_TYPE", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ state: "x" })), "state"), ["WRONG_TYPE"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ state: [] })), "state"), ["WRONG_TYPE"]);
});

test("state.key_files must be an array of strings", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ state: { key_files: "x" } })), "state.key_files"), ["NOT_ARRAY"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ state: { key_files: [1] } })), "state.key_files[0]"), ["WRONG_TYPE"]);
  assert.equal(validatePacket(validPacket({ state: { key_files: ["a.js", "b.js"] } })).valid, true);
});

test("artifacts must be an array; each entry validated with an artifacts[i]. prefix", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ artifacts: "x" })), "artifacts"), ["NOT_ARRAY"]);
  const r = validatePacket(validPacket({ artifacts: [{ path: "" }] }));
  assert.deepEqual(codeAt(r, "artifacts[0].path"), ["EMPTY_STRING"]);
  const r2 = validatePacket(validPacket({ artifacts: [{ path: "ok" }, { hash: "bad" }] }));
  assert.deepEqual(codeAt(r2, "artifacts[1].path"), ["MISSING_FIELD"]);
  assert.deepEqual(codeAt(r2, "artifacts[1].hash"), ["INVALID_SHA256"]);
});

test("a whole non-object artifact reports NOT_OBJECT at artifacts[i]", () => {
  const r = validatePacket(validPacket({ artifacts: [42] }));
  assert.deepEqual(codeAt(r, "artifacts[0]"), ["NOT_OBJECT"]);
});

test("provenance must be an object → WRONG_TYPE", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: "x" })), "provenance"), ["WRONG_TYPE"]);
});

test("provenance.handed_off_by wrong type / empty", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: { handed_off_by: 1, created: "2026-07-11T12:00:00Z" } })), "provenance.handed_off_by"), ["WRONG_TYPE"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: { handed_off_by: "  ", created: "2026-07-11T12:00:00Z" } })), "provenance.handed_off_by"), ["EMPTY_STRING"]);
});

test("provenance.created must be ISO-8601 UTC → INVALID_ISO8601", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: { handed_off_by: "c", created: "nope" } })), "provenance.created"), ["INVALID_ISO8601"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: { handed_off_by: "c", created: "2026-07-11T12:00:00+00:00" } })), "provenance.created"), ["INVALID_ISO8601"]);
  assert.deepEqual(codeAt(validatePacket(validPacket({ provenance: { handed_off_by: "c", created: "2026-02-30T00:00:00Z" } })), "provenance.created"), ["INVALID_ISO8601"]);
});

test("provenance.from_session must be a string → WRONG_TYPE", () => {
  const p = validPacket({ provenance: { handed_off_by: "c", created: "2026-07-11T12:00:00Z", from_session: 5 } });
  assert.deepEqual(codeAt(validatePacket(p), "provenance.from_session"), ["WRONG_TYPE"]);
});

test("unknown provenance field → UNKNOWN_FIELD", () => {
  const p = validPacket({ provenance: { handed_off_by: "c", created: "2026-07-11T12:00:00Z", bogus: 1 } });
  assert.deepEqual(codeAt(validatePacket(p), "provenance.bogus"), ["UNKNOWN_FIELD"]);
});

test("unknown top-level field → UNKNOWN_FIELD", () => {
  assert.deepEqual(codeAt(validatePacket(validPacket({ foo: "bar" })), "foo"), ["UNKNOWN_FIELD"]);
});

test("non-object input → single NOT_OBJECT at ''", () => {
  for (const bad of [null, [], 42, "x", undefined]) {
    const result = validatePacket(bad);
    assert.deepEqual(codes(result), ["NOT_OBJECT"]);
    assert.equal(result.errors[0].path, "");
  }
});

test("packet collects every violation without short-circuiting", () => {
  const result = validatePacket({
    id: "nope",
    version: 0,
    goal: "",
    context: 5,
    progress: "x",
    state: [],
    next_steps: [1],
    open_questions: "y",
    artifacts: "z",
    provenance: { created: "bad" },
    extra: 1,
  });
  const c = codes(result);
  assert.ok(c.includes("INVALID_SHA256"));
  assert.ok(c.includes("INVALID_INTEGER"));
  assert.ok(c.includes("EMPTY_STRING"));
  assert.ok(c.includes("WRONG_TYPE"));
  assert.ok(c.includes("NOT_ARRAY"));
  assert.ok(c.includes("MISSING_FIELD")); // provenance.handed_off_by
  assert.ok(c.includes("INVALID_ISO8601"));
  assert.ok(c.includes("UNKNOWN_FIELD"));
  assert.ok(result.errors.length >= 8);
});

// --- validateArtifact ------------------------------------------------------

test("valid artifact (path only) → valid", () => {
  assert.deepEqual(validateArtifact({ path: "src/x.js" }), { valid: true, errors: [] });
});

test("valid artifact with hash + note → valid", () => {
  assert.deepEqual(validateArtifact({ path: "src/x.js", hash: HEX, note: "n" }), { valid: true, errors: [] });
});

test("artifact path required, string, non-empty", () => {
  assert.deepEqual(codeAt(validateArtifact({}), "path"), ["MISSING_FIELD"]);
  assert.deepEqual(codeAt(validateArtifact({ path: 5 }), "path"), ["WRONG_TYPE"]);
  assert.deepEqual(codeAt(validateArtifact({ path: "  " }), "path"), ["EMPTY_STRING"]);
});

test("artifact hash (if present) must be sha256 hex", () => {
  assert.deepEqual(codeAt(validateArtifact({ path: "x", hash: "nope" }), "hash"), ["INVALID_SHA256"]);
  assert.deepEqual(codeAt(validateArtifact({ path: "x", hash: "A".repeat(64) }), "hash"), ["INVALID_SHA256"]);
});

test("artifact note (if present) must be a string", () => {
  assert.deepEqual(codeAt(validateArtifact({ path: "x", note: 5 }), "note"), ["WRONG_TYPE"]);
});

test("artifact unknown field → UNKNOWN_FIELD; non-object → NOT_OBJECT", () => {
  assert.deepEqual(codeAt(validateArtifact({ path: "x", extra: 1 }), "extra"), ["UNKNOWN_FIELD"]);
  for (const bad of [null, [], 42, "x", undefined]) {
    assert.deepEqual(codes(validateArtifact(bad)), ["NOT_OBJECT"]);
  }
});
