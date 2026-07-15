// Regression tests for the Codex (Sol) review findings. Each fails against the
// pre-fix code and passes after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePacket, ERROR_CODES } from "../src/schema.js";
import { computeId } from "../src/id.js";
import { savePacket, loadPacket } from "../src/io.js";
import { diffPackets } from "../src/diff.js";
import { capProgress } from "../src/adapters/limit.js";

function validPacket(overrides = {}) {
  const base = {
    version: 1,
    goal: "ship the parser",
    progress: ["a", "b"],
    state: { cursor: 5, key_files: ["src/x.js"] },
    provenance: { handed_off_by: "claude", created: "2026-07-11T12:00:00Z" },
    ...overrides,
  };
  if (!("id" in overrides)) base.id = computeId(base);
  return base;
}
const codes = (r) => r.errors.map((e) => e.code);

// --- HIGH [0]: id must equal the content hash -------------------------------
test("validatePacket rejects a well-formed id that isn't the real content hash", () => {
  const p = validPacket();
  assert.equal(validatePacket(p).valid, true);
  const tampered = { ...p, goal: "SECRETLY CHANGED" }; // id no longer matches
  const r = validatePacket(tampered);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes(ERROR_CODES.ID_MISMATCH));
});

// --- HIGH [1]: non-JSON values are rejected ---------------------------------
test("validatePacket rejects non-JSON values (undefined, Date, cycle)", () => {
  assert.ok(codes(validatePacket(validPacket({ id: undefined, state: { x: undefined } }))).includes(ERROR_CODES.NOT_JSON));
  assert.ok(codes(validatePacket(validPacket({ id: undefined, state: { when: new Date() } }))).includes(ERROR_CODES.NOT_JSON));
  const cyc = validPacket({ id: undefined });
  cyc.state.self = cyc.state; // cycle
  assert.ok(codes(validatePacket(cyc)).includes(ERROR_CODES.NOT_JSON));
  // and it does NOT throw on the cycle
  assert.doesNotThrow(() => validatePacket(cyc));
});

// --- MEDIUM [2]: savePacket is atomic (temp then rename) ---------------------
test("savePacket replaces atomically and leaves no temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ho-io-"));
  const path = join(dir, "packet.json");
  savePacket(path, validPacket());
  savePacket(path, validPacket({ goal: "second write" }));
  assert.equal(loadPacket(path).goal, "second write");
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes("handover-tmp")), [], "no temp files left behind");
  assert.match(readFileSync(path, "utf8"), /\n$/);
  rmSync(dir, { recursive: true, force: true });
});

// --- MEDIUM [3]: key_files changes surface in the diff ----------------------
test("diffPackets reports a key_files change", () => {
  const a = { state: { key_files: ["x.js"] }, provenance: { handed_off_by: "c", created: "2026-01-01T00:00:00Z" }, goal: "g" };
  const b = { state: { key_files: ["y.js"] }, provenance: { handed_off_by: "c", created: "2026-01-01T00:00:00Z" }, goal: "g" };
  assert.ok(diffPackets(a, b).state_keys_changed.includes("key_files"));
});

// --- LOW [4]: capProgress cap is well-defined -------------------------------
test("capProgress handles 0, negatives, fractions, and non-arrays", () => {
  const p = ["1", "2", "3", "4", "5"];
  assert.deepEqual(capProgress(p, 0), [], "0 means none, not everything");
  assert.deepEqual(capProgress(p, 2), ["4", "5"]);
  assert.deepEqual(capProgress(p, -3), p.slice(-12)); // negative → fallback 12 → all 5
  assert.deepEqual(capProgress(p, 2.5), p.slice(-12)); // fractional → fallback
  assert.deepEqual(capProgress(p, "x"), p.slice(-12)); // non-number → fallback
  assert.deepEqual(capProgress(null, 3), []); // non-array progress
});
