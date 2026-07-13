// handover — packet completeness scoring.
//
// A packet can be schema-valid (a goal, an agent, a timestamp) yet nearly empty
// — useless to a resuming agent. `completeness` grades how much of the handoff a
// fresh agent actually has to work with: which sections carry real content, which
// are blank, and a few plain-language warnings about gaps that tend to strand the
// next agent. Pure and total: it never throws and reads only the packet.

import { REQUIRED_SECTIONS } from "./schema.js";

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A section counts as "present" when it carries real content: goal/context are
// non-empty strings; the list sections have length > 0; state has at least one key.
function sectionPresent(packet, section) {
  const v = packet[section];
  switch (section) {
    case "goal":
    case "context":
      return typeof v === "string" && v.trim().length > 0;
    case "progress":
    case "next_steps":
    case "open_questions":
    case "artifacts":
      return Array.isArray(v) && v.length > 0;
    case "state":
      return isPlainObject(v) && Object.keys(v).length > 0;
    default:
      return false;
  }
}

// Extract file-path-like tokens from a string (a token with a slash or a dotted
// extension), used to spot artifacts a progress note mentions but never lists.
const PATH_LIKE = /[\w.\-/]*[\w\-]\/[\w.\-/]+|[\w.\-]+\.[A-Za-z0-9]{1,8}/g;

function mentionedPaths(text) {
  if (typeof text !== "string") return [];
  const m = text.match(PATH_LIKE);
  return m ? m : [];
}

// completeness(packet) → { score, total, present, missing, warnings }.
//
//   score    — present.length / total, over REQUIRED_SECTIONS (0..1).
//   total    — REQUIRED_SECTIONS.length.
//   present  — section names carrying real content.
//   missing  — section names empty or absent.
//   warnings — plain-language notes about gaps that tend to strand a resumer.
export function completeness(packet) {
  const obj = isPlainObject(packet) ? packet : {};
  const present = [];
  const missing = [];

  for (const section of REQUIRED_SECTIONS) {
    if (sectionPresent(obj, section)) present.push(section);
    else missing.push(section);
  }

  const total = REQUIRED_SECTIONS.length;
  const score = total === 0 ? 0 : present.length / total;

  const warnings = [];

  // A handoff with no next steps is either finished or under-specified — either
  // way the resumer should be told.
  const nextSteps = Array.isArray(obj.next_steps) ? obj.next_steps : [];
  if (nextSteps.length === 0) {
    warnings.push("no next steps — is the task complete, or was the handoff cut short?");
  }

  // Progress recorded but nothing named in `artifacts` — the next agent has no
  // pointer to the files the work lives in.
  const progress = Array.isArray(obj.progress) ? obj.progress : [];
  const artifacts = Array.isArray(obj.artifacts) ? obj.artifacts : [];
  if (progress.length > 0 && artifacts.length === 0) {
    warnings.push("progress recorded but no artifacts listed — will the next agent find the files?");
  }

  // Paths a progress note mentions that never appear in `artifacts` (or state's
  // key_files) — likely the concrete files the resumer needs, left implicit.
  const artifactPaths = new Set(
    artifacts.map((a) => (a && typeof a.path === "string" ? a.path : null)).filter(Boolean)
  );
  const keyFiles = isPlainObject(obj.state) && Array.isArray(obj.state.key_files) ? obj.state.key_files : [];
  for (const f of keyFiles) if (typeof f === "string") artifactPaths.add(f);

  const flagged = new Set();
  for (const line of progress) {
    for (const p of mentionedPaths(line)) {
      if (!artifactPaths.has(p) && !flagged.has(p)) {
        flagged.add(p);
        warnings.push(`progress mentions "${p}" but it is not in artifacts or key_files`);
      }
      if (warnings.length >= 8) break; // keep the report readable
    }
    if (warnings.length >= 8) break;
  }

  // No working state at all — the resumer starts cold with only prose.
  if (!sectionPresent(obj, "state")) {
    warnings.push("no working state captured — the resuming agent starts from prose alone");
  }

  return { score, total, present, missing, warnings };
}
