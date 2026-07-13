// handover — content-hash ids and the artifact fingerprint primitive.
//
// A packet's `id` is the sha256 content hash of the record with its own `id`
// excluded, so an identical packet always gets an identical id and any edit to a
// section changes it — the id IS the content. `canonicalize` produces the stable
// hash pre-image (sorted keys, no incidental whitespace, recursive) so key order
// can never perturb the digest. `computeHash` is the same primitive applied to
// an artifact's raw bytes, for filling in `artifacts[].hash`. Node's built-in
// `crypto` is the only "dependency"; there are zero runtime packages.

import { createHash } from "node:crypto";

// canonicalize(record) → deterministic JSON string with sorted keys and no
// incidental whitespace, over the record EXCLUDING its own `id`. Recurses so key
// ordering can never perturb the digest at any depth. Used as the hash pre-image;
// it does not need to round-trip to a value.
export function canonicalize(record) {
  const { id: _id, ...rest } = record;
  return stableStringify(rest);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

// computeId(record) → the sha256 content hash of the packet (its `id` excluded).
// Deterministic and content-addressed: identical content ⇒ identical id, so a
// packet edited into a new state gets a new id while a byte-identical copy keeps
// the old one.
export function computeId(record) {
  return createHash("sha256").update(canonicalize(record)).digest("hex");
}

// computeHash(content) → the sha256 hex digest of `content`. Accepts a string
// (hashed as UTF-8) or a Buffer (hashed as raw bytes). Used to fingerprint an
// artifact's bytes so `artifacts[].hash` can be re-verified offline.
export function computeHash(content) {
  return createHash("sha256").update(content).digest("hex");
}
