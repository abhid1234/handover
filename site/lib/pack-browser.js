// handover — `pack` + `revise` (BROWSER port).
//
// The validation, defaulting, field-ordering, append/merge, and version-bump
// logic below is copied VERBATIM from src/pack.js. The ONLY adaptation: the id
// is content-hashed with the async Web Crypto `computeId` from ./id-browser.js,
// so `assemble` / `pack` / `revise` are async and return Promises of the same
// packet the published (synchronous) library builds.

import { computeId } from "./id-browser.js";
import { isIso8601Utc, validatePacket } from "./schema.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function assemble({ version, goal, context, progress, state, next_steps, open_questions, artifacts, provenance }) {
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
  return { id: await computeId(body), ...body };
}

export async function pack(input = {}) {
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

  const packet = await assemble({
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

  const result = validatePacket(packet);
  if (!result.valid) {
    const detail = result.errors
      .map((e) => `${e.path === "" ? "<root>" : e.path}: ${e.message}`)
      .join("; ");
    throw new Error(`pack: produced an invalid packet — ${detail}`);
  }

  return packet;
}

export async function revise(packet, patch = {}) {
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

  const packet2 = await assemble({
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
