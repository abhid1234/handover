// handover — content-hash ids (BROWSER port).
//
// `canonicalize` and `stableStringify` are copied VERBATIM from src/id.js — the
// stable hash pre-image (sorted keys, no incidental whitespace, recursive) is
// pure and identical to the published library. The ONLY change is how the sha256
// is computed: Node's `node:crypto` createHash is swapped for the Web Crypto
// `crypto.subtle.digest('SHA-256', …)` primitive, which is async — so
// `computeId` / `computeHash` here return Promises of the same hex digest the
// library produces. Given identical content, this yields a byte-identical id.

// --- VERBATIM from src/id.js ---
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
// --- end verbatim ---

// hex(buffer) → lowercase hex string of an ArrayBuffer.
function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

// computeId(record) → Promise<sha256 hex of the record with its own `id`
// excluded>. Same content-addressing semantics as the library's synchronous
// computeId, just async because Web Crypto is async.
export async function computeId(record) {
  return sha256Hex(canonicalize(record));
}

// computeHash(content) → Promise<sha256 hex of the UTF-8 content>.
export async function computeHash(content) {
  return sha256Hex(content);
}
