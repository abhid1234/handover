// handover — Claude Code transcript adapter (a draft-packet surface).
//
// This turns a Claude Code `.jsonl` session transcript into a PARTIAL packet
// DRAFT: a starting point the user refines by hand and then passes to `pack()`.
// It is deliberately NOT a validated, final packet — a transcript can't know the
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

// Pull display text out of a Claude Code message entry. `message.content` is
// either a plain string or an array of typed blocks; only `text` blocks carry
// prose. Anything else (tool_use, tool_result, thinking) contributes nothing.
function extractText(entry) {
  const msg = entry && entry.message;
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Lines the assistant wrote as bullets or numbered items — the closest thing a
// transcript has to a progress log. Deduped, order-preserved, capped.
function bulletLines(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const m = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/.exec(raw);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// fromClaudeCode(rawTranscript, opts) → a partial packet draft.
//
//   rawTranscript — the `.jsonl` file contents (one JSON object per line).
//   opts.agent       — who will hand off (seeds the eventual provenance).
//   opts.from_session — originating session id, if known.
//   opts.max_progress — cap on inferred progress bullets (default 12).
//
// The result is a DRAFT, not a valid packet: no `created`, no `id`, sections the
// transcript can't infer left at their empty defaults. Refine it, then call
// `pack()` (which validates and stamps the handoff).
export function fromClaudeCode(rawTranscript, opts = {}) {
  const { agent, from_session, max_progress = 12 } = opts;

  const userTexts = [];
  const assistantTexts = [];

  for (const line of String(rawTranscript ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // tolerate a malformed / partial line
    }
    if (!entry || typeof entry !== "object") continue;
    const role = entry.type || (entry.message && entry.message.role);
    const text = extractText(entry);
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
    progress: progress.slice(-max_progress),
    state: {},
    next_steps: [],
    open_questions: [],
    artifacts: [],
  };
  if (agent !== undefined) draft.agent = agent;
  if (from_session !== undefined) draft.from_session = from_session;

  return draft;
}
