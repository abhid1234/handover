// handover — packet persistence (the single JSON document store).
//
// A handover packet is ONE JSON document, not an append-only ledger — there is
// no registry to fold, no revocation to apply. This module is the thin I/O layer
// that keeps every filesystem access in one place: write a packet as pretty JSON
// (creating its parent directory), read one back (with clear errors on a missing
// file or malformed JSON), and resolve the default location. Node's built-in
// `fs`/`path` are the only "dependencies"; there are zero runtime packages.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// defaultPacketPath(cwd) → the ONE place the default packet location is defined.
// `HANDOVER_PACKET` overrides, else `.handover/packet.json` under `cwd`.
export function defaultPacketPath(cwd = process.cwd()) {
  return process.env.HANDOVER_PACKET || join(cwd, ".handover", "packet.json");
}

// savePacket(path, packet) → the packet, written to `path` as pretty JSON with a
// trailing newline. Creates the parent directory if needed. Overwrites in place —
// a packet is a single living document, not an append log.
export function savePacket(path, packet) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(packet, null, 2) + "\n");
  return packet;
}

// loadPacket(path) → the parsed packet object. Throws a clear Error if the file
// is missing (ENOENT) or does not contain valid JSON — a caller asking for a
// specific packet means a missing or corrupt one is a mistake to surface, not to
// swallow. Structural validation is the schema's job, not this loader's.
export function loadPacket(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      throw new Error(`loadPacket: no packet at ${path}`);
    }
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`loadPacket: ${path} is not valid JSON — ${e.message}`);
  }
}
