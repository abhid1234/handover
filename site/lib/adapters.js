// handover — adapter registry.
//
// Each adapter turns a harness's native session artifact (a transcript, a log)
// into a partial packet DRAFT the user refines and then `pack()`s. They are kept
// behind a small name→function registry so a CLI or harness can resolve one by
// harness name without importing every module. Every adapter shares the same
// contract: `(raw, opts) → draftPacket` (partial, unvalidated, no `created`).

import { fromClaudeCode } from "./claude-code.js";
import { fromCodex } from "./codex.js";
import { fromCursor } from "./cursor.js";
import { fromAntigravity } from "./antigravity.js";

export { fromClaudeCode, fromCodex, fromCursor, fromAntigravity };

// ADAPTERS[name] → the draft-builder for that harness. Add new harnesses here.
export const ADAPTERS = {
  "claude-code": fromClaudeCode,
  codex: fromCodex,
  cursor: fromCursor,
  antigravity: fromAntigravity,
};

// getAdapter(name) → the adapter function, or null if the harness is unknown.
export function getAdapter(name) {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, name) ? ADAPTERS[name] : null;
}
