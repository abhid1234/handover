import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePacket, loadPacket, defaultPacketPath } from "../src/io.js";
import { pack } from "../src/pack.js";

const CREATED = "2026-07-11T12:00:00Z";

let dir;
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), "handover-io-"));
});
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HANDOVER_PACKET;
});

test("savePacket → loadPacket round-trips a packet exactly", () => {
  const p = pack({ goal: "ship", agent: "claude", created: CREATED, progress: ["a"], state: { cursor: 5 } });
  const path = join(dir, "packet.json");
  const returned = savePacket(path, p);
  assert.deepEqual(returned, p); // savePacket returns the packet
  assert.deepEqual(loadPacket(path), p);
});

test("savePacket writes pretty JSON with a trailing newline", () => {
  const p = pack({ goal: "g", agent: "c", created: CREATED });
  const path = join(dir, "pretty.json");
  savePacket(path, p);
  const raw = readFileSync(path, "utf8");
  assert.ok(raw.endsWith("\n"));
  assert.ok(raw.includes("\n  ")); // indented
  assert.deepEqual(JSON.parse(raw), p);
});

test("savePacket creates missing parent directories", () => {
  const p = pack({ goal: "g", agent: "c", created: CREATED });
  const path = join(dir, "nested", "deep", "packet.json");
  savePacket(path, p);
  assert.ok(existsSync(path));
  assert.deepEqual(loadPacket(path), p);
});

test("savePacket overwrites in place (single living document, not a log)", () => {
  const path = join(dir, "overwrite.json");
  const p1 = pack({ goal: "g", agent: "c", created: CREATED });
  const p2 = pack({ goal: "g", agent: "c", created: CREATED, progress: ["x"] });
  savePacket(path, p1);
  savePacket(path, p2);
  assert.deepEqual(loadPacket(path), p2);
  // Exactly one JSON document on disk.
  assert.equal(readFileSync(path, "utf8").trim().split("\n").filter((l) => l === "}").length, 1);
});

test("loadPacket throws a clear error on a missing file (ENOENT)", () => {
  assert.throws(() => loadPacket(join(dir, "does-not-exist.json")), /no packet at/);
});

test("loadPacket throws a clear error on malformed JSON", () => {
  const path = join(dir, "broken.json");
  writeFileSync(path, "{ not valid json ");
  assert.throws(() => loadPacket(path), /not valid JSON/);
});

test("defaultPacketPath defaults to .handover/packet.json under cwd", () => {
  delete process.env.HANDOVER_PACKET;
  assert.equal(defaultPacketPath("/work/repo"), join("/work/repo", ".handover", "packet.json"));
});

test("defaultPacketPath honors the HANDOVER_PACKET env override", () => {
  process.env.HANDOVER_PACKET = "/custom/where.json";
  assert.equal(defaultPacketPath("/work/repo"), "/custom/where.json");
  delete process.env.HANDOVER_PACKET;
});
