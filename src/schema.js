// handover — packet schema and validators.
//
// Pure, zero-dependency validators for the open `handover packet` shape: a
// single JSON document capturing everything a fresh agent needs to RESUME an
// in-progress task. None of these functions throw on bad input; each returns
// `{ valid, errors }` and collects *every* violation (no short-circuit) so a
// harness or human can fix everything in one pass.
//
// Error = { path: string, code: string, message: string }
//   path — dot/bracket path to the offending value ("artifacts[0].path",
//          "provenance.created", or "" for the whole object).
//   code — a stable machine-readable code from ERROR_CODES.
//   message — one-line human explanation.

import { computeId } from "./id.js";

// The exact set of allowed top-level packet fields, in canonical order. `id` and
// `version` are derived/optional; `goal` and `provenance` are the spine.
export const PACKET_FIELDS = [
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
];

// The section keys `completeness` scores a packet over — the parts a resuming
// agent actually reads. Ordered as they render in a briefing.
export const REQUIRED_SECTIONS = [
  "goal",
  "context",
  "progress",
  "state",
  "next_steps",
  "open_questions",
  "artifacts",
];

export const ERROR_CODES = {
  MISSING_FIELD: "MISSING_FIELD",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  WRONG_TYPE: "WRONG_TYPE",
  NOT_OBJECT: "NOT_OBJECT",
  NOT_ARRAY: "NOT_ARRAY",
  EMPTY_STRING: "EMPTY_STRING",
  INVALID_INTEGER: "INVALID_INTEGER",
  INVALID_ISO8601: "INVALID_ISO8601",
  INVALID_SHA256: "INVALID_SHA256",
  ID_MISMATCH: "ID_MISMATCH",
  NOT_JSON: "NOT_JSON",
};

// firstNonJson(value) → { path, msg } for the first value that would not survive
// a JSON round-trip (undefined, function, symbol, bigint, non-finite number, a
// non-plain object like Date/Map/class instance, or a cycle), or null if the
// whole structure is JSON-safe. A packet is a JSON document; a non-JSON value
// would hash inconsistently, break rendering, or vanish on save/load.
function firstNonJson(value, path, seen) {
  const t = typeof value;
  if (value === null || t === "string" || t === "boolean") return null;
  if (t === "number") return Number.isFinite(value) ? null : { path, msg: "a non-finite number" };
  if (t === "undefined" || t === "bigint" || t === "function" || t === "symbol") {
    return { path, msg: `a ${t === "undefined" ? "undefined" : t} value` };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return { path, msg: "a circular reference" };
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      const r = firstNonJson(value[i], `${path}[${i}]`, seen);
      if (r) return r;
    }
    seen.delete(value);
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return { path, msg: `a non-plain object (${(value.constructor && value.constructor.name) || "unknown"})` };
  }
  if (seen.has(value)) return { path, msg: "a circular reference" };
  seen.add(value);
  for (const k of Object.keys(value)) {
    const r = firstNonJson(value[k], path ? `${path}.${k}` : k, seen);
    if (r) return r;
  }
  seen.delete(value);
  return null;
}

// Strict ISO-8601 UTC: YYYY-MM-DDTHH:MM:SS(.sss)?Z. The regex gates the format
// (UTC `Z` only, no offsets); Date.parse gates real-calendar validity so
// impossible dates like 2026-13-40T00:00:00Z are rejected.
const ISO8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// A lowercase sha256 digest: exactly 64 hex characters. Content-hash ids and
// artifact hashes are both one of these.
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isIso8601Utc(s) {
  if (typeof s !== "string" || !ISO8601_UTC.test(s)) return false;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return false;
  // Date.parse silently rolls over impossible calendar dates (e.g.
  // 2026-02-30 → Mar 2, 2026-04-31 → May 1) instead of returning NaN, so a
  // format-valid but nonexistent date would slip through. Round-trip the
  // parsed value and require the calendar portion to match the input.
  return new Date(ms).toISOString().slice(0, 10) === s.slice(0, 10);
}

export function isSha256Hex(s) {
  return typeof s === "string" && SHA256_HEX.test(s);
}

function err(path, code, message) {
  return { path, code, message };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Validate an array-of-strings section (progress / next_steps / open_questions),
// pushing one error per offending element under `<field>[i]`.
function checkStringArray(errors, obj, field) {
  const v = obj[field];
  if (!Array.isArray(v)) {
    errors.push(err(field, ERROR_CODES.NOT_ARRAY, `${field} must be an array`));
    return;
  }
  v.forEach((item, i) => {
    if (typeof item !== "string") {
      errors.push(err(`${field}[${i}]`, ERROR_CODES.WRONG_TYPE, `${field}[${i}] must be a string`));
    }
  });
}

// validateArtifact(obj) → { valid, errors } for one artifact entry. `path` is
// required and non-empty; `hash` (if present) must be a sha256 hex digest; `note`
// (if present) must be a string. Error paths are relative ("path", "hash",
// "note"); callers re-prefix with "artifacts[i].".
export function validateArtifact(obj) {
  if (!isPlainObject(obj)) {
    return {
      valid: false,
      errors: [err("", ERROR_CODES.NOT_OBJECT, "artifact must be a JSON object")],
    };
  }

  const errors = [];

  if (!("path" in obj)) {
    errors.push(err("path", ERROR_CODES.MISSING_FIELD, "path is required"));
  } else if (typeof obj.path !== "string") {
    errors.push(err("path", ERROR_CODES.WRONG_TYPE, "path must be a string"));
  } else if (obj.path.trim().length === 0) {
    errors.push(err("path", ERROR_CODES.EMPTY_STRING, "path must not be empty"));
  }

  if ("hash" in obj && !isSha256Hex(obj.hash)) {
    errors.push(err("hash", ERROR_CODES.INVALID_SHA256, "hash must be a sha256 hex digest (64 hex chars)"));
  }

  if ("note" in obj && typeof obj.note !== "string") {
    errors.push(err("note", ERROR_CODES.WRONG_TYPE, "note must be a string"));
  }

  for (const key of Object.keys(obj)) {
    if (!["path", "hash", "note"].includes(key)) {
      errors.push(err(key, ERROR_CODES.UNKNOWN_FIELD, `unknown field: ${key}`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// validatePacket(obj) → { valid, errors }. A packet is valid when it carries a
// non-empty `goal` and a `provenance` with a `handed_off_by` and an ISO-8601-UTC
// `created`; every other section is optional but is type-checked when present.
export function validatePacket(obj) {
  // 1. Must be a non-null plain object.
  if (!isPlainObject(obj)) {
    return {
      valid: false,
      errors: [err("", ERROR_CODES.NOT_OBJECT, "packet must be a JSON object")],
    };
  }

  const errors = [];

  // 2. Required top-level fields.
  if (!("goal" in obj)) {
    errors.push(err("goal", ERROR_CODES.MISSING_FIELD, "goal is required"));
  }
  if (!("provenance" in obj)) {
    errors.push(err("provenance", ERROR_CODES.MISSING_FIELD, "provenance is required"));
  }

  // 3. Unknown top-level fields.
  for (const key of Object.keys(obj)) {
    if (!PACKET_FIELDS.includes(key)) {
      errors.push(err(key, ERROR_CODES.UNKNOWN_FIELD, `unknown field: ${key}`));
    }
  }

  // 4a. The whole packet must be JSON data (no undefined/function/Date/cycle/…).
  // Run this BEFORE the id check so a cyclic structure can't make computeId throw.
  const nonJson = firstNonJson(obj, "", new Set());
  if (nonJson) {
    errors.push(err(nonJson.path, ERROR_CODES.NOT_JSON, `value must be JSON-serializable, found ${nonJson.msg}`));
  }

  // 4. Per-field type/shape (only for fields that are present).
  if ("id" in obj) {
    if (!isSha256Hex(obj.id)) {
      errors.push(err("id", ERROR_CODES.INVALID_SHA256, "id must be a sha256 hex digest (64 hex chars)"));
    } else if (!nonJson && obj.id !== computeId(obj)) {
      // A well-formed digest that isn't the ACTUAL content hash means the packet
      // was edited after its id was set — the id no longer proves integrity.
      errors.push(err("id", ERROR_CODES.ID_MISMATCH, "id does not match the packet's content hash (packet modified after its id was set)"));
    }
  }

  if ("version" in obj && (!Number.isInteger(obj.version) || obj.version < 1)) {
    errors.push(err("version", ERROR_CODES.INVALID_INTEGER, "version must be an integer >= 1"));
  }

  if ("goal" in obj) {
    if (typeof obj.goal !== "string") {
      errors.push(err("goal", ERROR_CODES.WRONG_TYPE, "goal must be a string"));
    } else if (obj.goal.trim().length === 0) {
      errors.push(err("goal", ERROR_CODES.EMPTY_STRING, "goal must not be empty"));
    }
  }

  if ("context" in obj && typeof obj.context !== "string") {
    errors.push(err("context", ERROR_CODES.WRONG_TYPE, "context must be a string"));
  }

  if ("progress" in obj) checkStringArray(errors, obj, "progress");
  if ("next_steps" in obj) checkStringArray(errors, obj, "next_steps");
  if ("open_questions" in obj) checkStringArray(errors, obj, "open_questions");

  if ("state" in obj) {
    if (!isPlainObject(obj.state)) {
      errors.push(err("state", ERROR_CODES.WRONG_TYPE, "state must be an object"));
    } else if ("key_files" in obj.state) {
      const kf = obj.state.key_files;
      if (!Array.isArray(kf)) {
        errors.push(err("state.key_files", ERROR_CODES.NOT_ARRAY, "state.key_files must be an array"));
      } else {
        kf.forEach((f, i) => {
          if (typeof f !== "string") {
            errors.push(
              err(`state.key_files[${i}]`, ERROR_CODES.WRONG_TYPE, "state.key_files entry must be a string")
            );
          }
        });
      }
    }
  }

  if ("artifacts" in obj) {
    if (!Array.isArray(obj.artifacts)) {
      errors.push(err("artifacts", ERROR_CODES.NOT_ARRAY, "artifacts must be an array"));
    } else {
      obj.artifacts.forEach((a, i) => {
        const result = validateArtifact(a);
        for (const e of result.errors) {
          const path = e.path === "" ? `artifacts[${i}]` : `artifacts[${i}].${e.path}`;
          errors.push(err(path, e.code, e.message));
        }
      });
    }
  }

  if ("provenance" in obj) {
    const p = obj.provenance;
    if (!isPlainObject(p)) {
      errors.push(err("provenance", ERROR_CODES.WRONG_TYPE, "provenance must be an object"));
    } else {
      if (!("handed_off_by" in p)) {
        errors.push(err("provenance.handed_off_by", ERROR_CODES.MISSING_FIELD, "provenance.handed_off_by is required"));
      } else if (typeof p.handed_off_by !== "string") {
        errors.push(err("provenance.handed_off_by", ERROR_CODES.WRONG_TYPE, "provenance.handed_off_by must be a string"));
      } else if (p.handed_off_by.trim().length === 0) {
        errors.push(err("provenance.handed_off_by", ERROR_CODES.EMPTY_STRING, "provenance.handed_off_by must not be empty"));
      }

      if (!("created" in p)) {
        errors.push(err("provenance.created", ERROR_CODES.MISSING_FIELD, "provenance.created is required"));
      } else if (!isIso8601Utc(p.created)) {
        errors.push(err("provenance.created", ERROR_CODES.INVALID_ISO8601, "provenance.created must be ISO 8601 UTC (…Z)"));
      }

      if ("from_session" in p && typeof p.from_session !== "string") {
        errors.push(err("provenance.from_session", ERROR_CODES.WRONG_TYPE, "provenance.from_session must be a string"));
      }

      for (const key of Object.keys(p)) {
        if (!["handed_off_by", "created", "from_session"].includes(key)) {
          errors.push(err(`provenance.${key}`, ERROR_CODES.UNKNOWN_FIELD, `unknown field: provenance.${key}`));
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
