import { capProgress } from "./limit.js";
// handover — OpenAI Codex CLI rollout adapter (a draft-packet surface).
//
// This turns a Codex CLI `.jsonl` rollout into a PARTIAL packet DRAFT: a starting
// point the user refines by hand and then passes to `pack()`. Like every adapter
// it is deliberately NOT a validated, final packet — a rollout can't know the
// working state, the real next steps, or which files matter, so this only seeds
// the sections it can reasonably infer:
//
//   goal     ← the latest user message (the current ask)
//   context  ← the most recent assistant turn (the model's current understanding)
//   progress ← bullet/numbered lines the assistant wrote across the session
//
// Pure and tolerant: a line that won't parse, or isn't a message, is skipped
// rather than aborting the parse. No I/O, no clock — the caller reads the file
// and supplies `created` when it finally `pack()`s.

// Codex rollout lines wrap the real record under a `payload` envelope
// (`{ type: "response_item", payload: { type: "message", … } }`); older/flat
// forms carry the fields directly. Unwrap to the record that holds role + content.
function unwrap(entry) {
  if (entry && typeof entry === "object" && entry.payload && typeof entry.payload === "object") {
    return entry.payload;
  }
  return entry;
}

// Pull display text out of a Codex message record. `content` is either a plain
// string or an array of typed blocks; Codex tags prose blocks `input_text`
// (user) and `output_text` (assistant). Only text-bearing blocks contribute —
// reasoning, function_call, and function_call_output blocks add nothing.
function extractText(item) {
  if (!item || typeof item !== "object") return "";
  const content = item.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) {
    return typeof item.text === "string" ? item.text.trim() : "";
  }
  return content
    .filter(
      (b) => b && typeof b.text === "string" && (b.type == null || String(b.type).includes("text"))
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Lines the assistant wrote as bullets or numbered items — the closest thing a
// rollout has to a progress log. Deduped, order-preserved, capped.
function bulletLines(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const m = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/.exec(raw);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// fromCodex(rawRollout, opts) → a partial packet draft.
//
//   rawRollout      — the `.jsonl` rollout contents (one JSON object per line).
//   opts.agent        — who will hand off (seeds the eventual provenance).
//   opts.from_session — originating session id, if known.
//   opts.max_progress — cap on inferred progress bullets (default 12).
//
// The result is a DRAFT, not a valid packet: no `created`, no `id`, sections the
// rollout can't infer left at their empty defaults. Refine it, then call `pack()`.
export function fromCodex(rawRollout, opts = {}) {
  const { agent, from_session, max_progress = 12 } = opts;

  const userTexts = [];
  const assistantTexts = [];

  for (const line of String(rawRollout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // tolerate a malformed / partial line
    }
    const item = unwrap(entry);
    if (!item || typeof item !== "object") continue;
    const role = item.role;
    const text = extractText(item);
    if (!text) continue;
    if (role === "user") userTexts.push(text);
    else if (role === "assistant") assistantTexts.push(text);
  }

  const goal = userTexts.length ? userTexts[userTexts.length - 1].trim() : "";
  const context = assistantTexts.length ? assistantTexts[assistantTexts.length - 1].trim() : "";

  const seen = new Set();
  const progress = [];
  for (const t of assistantTexts) {
    for (const b of bulletLines(t)) {
      if (!seen.has(b)) {
        seen.add(b);
        progress.push(b);
      }
    }
  }

  const draft = {
    goal,
    context,
    progress: capProgress(progress, max_progress),
    state: {},
    next_steps: [],
    open_questions: [],
    artifacts: [],
  };
  if (agent !== undefined) draft.agent = agent;
  if (from_session !== undefined) draft.from_session = from_session;

  return draft;
}
