// handover — `pack` + `revise` core (pure packet constructors).
//
// `pack` builds a valid handover packet with a deterministic content-hash id and
// all section defaults applied, with NO I/O and NO clock — `created` is injected,
// so the result is fully determined by its inputs and unit-testable. The CLI
// (`bin/handover.js`) is the only part that reads the clock and writes to disk.
//
// Unlike the schema validators (which never throw), these constructors *do*
// throw a clear Error on invalid input: a packet is meaningless without a goal,
// an agent to hand off, and a real timestamp, so building one from bad inputs is
// a programming error, not a data-validation result.

import { computeId } from "./id.js";
import { isIso8601Utc, validatePacket } from "./schema.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Assemble a packet body (id excluded) in canonical field order, apply defaults,
// then prepend the derived content-hash id. Shared by `pack` and `revise` so
// there is exactly one place the packet shape is built.
function assemble({ version, goal, context, progress, state, next_steps, open_questions, artifacts, provenance }) {
  const body = {
    version,
    goal,
    context,
    progress,
    state,
    next_steps,
    open_questions,
    artifacts,
    provenance,
  };
  return { id: computeId(body), ...body };
}

// pack(input) → a validated handover packet ready to write.
//
//   input.goal           — the task being handed off (non-empty)
//   input.agent          — who is handing it off → provenance.handed_off_by
//   input.created        — ISO-8601-UTC timestamp of the handoff (injected)
//   input.context        — constraints/background/decisions (default "")
//   input.progress       — what's been done (array of strings, default [])
//   input.state          — current working state object (default {}); may carry
//                          an optional `key_files` array of path strings
//   input.next_steps     — what to do next (array of strings, default [])
//   input.open_questions — unresolved questions (array of strings, default [])
//   input.artifacts      — [{ path, hash?, note? }] produced/touched (default [])
//   input.from_session   — optional originating session id → provenance
//   input.version        — packet version integer (default 1)
//
// `id` is the sha256 content hash of the whole record (its `id` excluded), so a
// packet's id IS its content. Throws on any invalid input rather than emitting a
// malformed packet; the finished packet is re-validated against the schema as a
// final gate.
export function pack(input = {}) {
  const {
    goal,
    agent,
    created,
    context = "",
    progress = [],
    state = {},
    next_steps = [],
    open_questions = [],
    artifacts = [],
    from_session,
    version = 1,
  } = input;

  if (!isNonEmptyString(goal)) {
    throw new Error("pack: goal must be a non-empty string");
  }
  if (!isNonEmptyString(agent)) {
    throw new Error("pack: agent must be a non-empty string (becomes provenance.handed_off_by)");
  }
  if (!isIso8601Utc(created)) {
    throw new Error("pack: created must be an ISO-8601 UTC timestamp (…Z)");
  }
  if (typeof context !== "string") {
    throw new Error("pack: context must be a string");
  }
  if (!Array.isArray(progress)) throw new Error("pack: progress must be an array");
  if (!Array.isArray(next_steps)) throw new Error("pack: next_steps must be an array");
  if (!Array.isArray(open_questions)) throw new Error("pack: open_questions must be an array");
  if (!Array.isArray(artifacts)) throw new Error("pack: artifacts must be an array");
  if (!isPlainObject(state)) throw new Error("pack: state must be an object");
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("pack: version must be an integer >= 1");
  }
  if (from_session !== undefined && typeof from_session !== "string") {
    throw new Error("pack: from_session must be a string");
  }

  const provenance = {
    handed_off_by: agent,
    created,
    ...(from_session !== undefined ? { from_session } : {}),
  };

  const packet = assemble({
    version,
    goal,
    context,
    progress: [...progress],
    state: { ...state },
    next_steps: [...next_steps],
    open_questions: [...open_questions],
    artifacts: artifacts.map((a) => ({ ...a })),
    provenance,
  });

  // Final gate: a malformed packet is a bug in the caller's inputs, so surface
  // it as a thrown Error listing every violation rather than returning it.
  const result = validatePacket(packet);
  if (!result.valid) {
    const detail = result.errors
      .map((e) => `${e.path === "" ? "<root>" : e.path}: ${e.message}`)
      .join("; ");
    throw new Error(`pack: produced an invalid packet — ${detail}`);
  }

  return packet;
}

// revise(packet, patch) → a NEW packet that checkpoints further progress on the
// same task. `version` is incremented; array sections in `patch` are APPENDED to
// the existing ones (progress, next_steps, open_questions, artifacts); scalar
// sections (goal, context) are REPLACED when present in the patch; `state` is
// shallow-merged (patch keys win). Provenance is refreshed — pass a new
// `patch.created` (ISO-8601-UTC) and optionally `patch.agent` / `patch.from_session`.
// The id is recomputed over the new content. Throws on invalid input.
export function revise(packet, patch = {}) {
  if (!isPlainObject(packet)) {
    throw new Error("revise: packet must be an object");
  }
  if (!isPlainObject(patch)) {
    throw new Error("revise: patch must be an object");
  }
  if (!isIso8601Utc(patch.created)) {
    throw new Error("revise: patch.created must be an ISO-8601 UTC timestamp (…Z) — a revision is a fresh handoff");
  }

  const prevProv = isPlainObject(packet.provenance) ? packet.provenance : {};
  const agent = patch.agent !== undefined ? patch.agent : prevProv.handed_off_by;
  if (!isNonEmptyString(agent)) {
    throw new Error("revise: no handed_off_by — pass patch.agent or revise a packet that has one");
  }

  const fromSession =
    patch.from_session !== undefined ? patch.from_session : prevProv.from_session;
  if (fromSession !== undefined && typeof fromSession !== "string") {
    throw new Error("revise: from_session must be a string");
  }

  const appendArray = (base, add) => {
    const start = Array.isArray(base) ? base : [];
    if (add === undefined) return [...start];
    if (!Array.isArray(add)) throw new Error("revise: array patch fields must be arrays");
    return [...start, ...add];
  };

  const goal = patch.goal !== undefined ? patch.goal : packet.goal;
  if (!isNonEmptyString(goal)) throw new Error("revise: goal must be a non-empty string");

  const context = patch.context !== undefined ? patch.context : (packet.context ?? "");
  if (typeof context !== "string") throw new Error("revise: context must be a string");

  const baseState = isPlainObject(packet.state) ? packet.state : {};
  if (patch.state !== undefined && !isPlainObject(patch.state)) {
    throw new Error("revise: patch.state must be an object");
  }
  const state = { ...baseState, ...(patch.state || {}) };

  const provenance = {
    handed_off_by: agent,
    created: patch.created,
    ...(fromSession !== undefined ? { from_session: fromSession } : {}),
  };

  const packet2 = assemble({
    version: (Number.isInteger(packet.version) ? packet.version : 1) + 1,
    goal,
    context,
    progress: appendArray(packet.progress, patch.progress),
    state,
    next_steps: appendArray(packet.next_steps, patch.next_steps),
    open_questions: appendArray(packet.open_questions, patch.open_questions),
    artifacts: appendArray(packet.artifacts, patch.artifacts).map((a) => ({ ...a })),
    provenance,
  });

  const result = validatePacket(packet2);
  if (!result.valid) {
    const detail = result.errors
      .map((e) => `${e.path === "" ? "<root>" : e.path}: ${e.message}`)
      .join("; ");
    throw new Error(`revise: produced an invalid packet — ${detail}`);
  }

  return packet2;
}
