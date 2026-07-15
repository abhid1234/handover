import { capProgress } from "./limit.js";
// handover — Google Antigravity session adapter (a draft-packet surface).
//
// This turns a Google Antigravity agent session — or an `AGENTS.md`-style task
// brief — into a PARTIAL packet DRAFT: a starting point the user refines by hand
// and then passes to `pack()`. Like every adapter it is deliberately NOT a
// validated, final packet — a session can't know the working state, the real next
// steps, or which files matter, so this only seeds the sections it can reasonably
// infer:
//
//   goal     ← the user's latest ask (the current task)
//   context  ← the most recent assistant turn (the model's current understanding)
//   progress ← bullet/numbered lines the assistant wrote across the session
//
// Antigravity's export shape isn't fixed, so this is pragmatic and tolerant: it
// reads a whole-document JSON session (`[…]` or `{ messages: […] }`), a `.jsonl`
// stream of message objects, a plain `User:` / `Assistant:` prose transcript, OR a
// marker-less `AGENTS.md` brief (headings + bullets) — whichever the input turns
// out to be. Anything that won't parse is skipped, never thrown. No I/O, no clock —
// the caller supplies `created` when it finally `pack()`s.

// Pull display text out of a message object. `content` is either a plain string
// or an array of typed blocks; only text-bearing blocks carry prose.
function extractText(msg) {
  if (!msg || typeof msg !== "object") return "";
  const content = msg.content ?? msg.text ?? msg.parts;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (typeof b === "string") return b;
      if (b && typeof b.text === "string" && (b.type == null || String(b.type).includes("text"))) {
        return b.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Normalize an assorted role label to "user" / "assistant" / null.
function normalizeRole(raw) {
  const r = String(raw ?? "").toLowerCase();
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai" || r === "model" || r === "agent") return "assistant";
  return null;
}

// Lift {role, text} messages out of a whole-document JSON session or a `.jsonl`
// stream. Returns [] when the input is prose rather than structured messages.
function structuredMessages(raw) {
  const s = String(raw ?? "");
  const trimmed = s.trim();
  const push = (out, m) => {
    if (!m || typeof m !== "object") return;
    const role = normalizeRole(m.role ?? m.type);
    const text = extractText(m);
    if (role && text) out.push({ role, text });
  };

  // A whole-document JSON: an array of messages, or `{ messages: […] }`.
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const doc = JSON.parse(trimmed);
      const arr = Array.isArray(doc) ? doc : Array.isArray(doc && doc.messages) ? doc.messages : null;
      if (arr) {
        const out = [];
        for (const m of arr) push(out, m);
        if (out.length) return out;
      }
    } catch {
      // fall through to the line-by-line stream form
    }
  }

  // A `.jsonl` stream: one message object per line (tolerant of junk lines).
  const out = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      push(out, JSON.parse(t));
    } catch {
      // not JSON — handled by the prose/AGENTS.md fallback in fromAntigravity
    }
  }
  return out;
}

// Split a `User:` / `Assistant:` prose transcript into {role, text} turns. Lines
// before any marker are ignored; a marker with no following text is dropped.
function proseMessages(raw) {
  const out = [];
  let role = null;
  let buf = [];
  const flush = () => {
    if (role && buf.join("\n").trim()) out.push({ role, text: buf.join("\n").trim() });
    buf = [];
  };
  for (const line of String(raw ?? "").split("\n")) {
    const m = /^\s*(user|human|assistant|ai|model|agent)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      flush();
      role = normalizeRole(m[1]);
      buf = m[2] ? [m[2]] : [];
    } else if (role) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

// Bullet/numbered lines — the closest thing a session has to a progress log.
function bulletLines(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const m = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/.exec(raw);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// fromAntigravity(rawSession, opts) → a partial packet draft.
//
//   rawSession      — an Antigravity session export (JSON / `.jsonl`),
//                     `User:`/`Assistant:` prose, or an `AGENTS.md` task brief.
//   opts.agent        — who will hand off (seeds the eventual provenance).
//   opts.from_session — originating session id, if known.
//   opts.max_progress — cap on inferred progress bullets (default 12).
//
// The result is a DRAFT, not a valid packet: no `created`, no `id`, sections the
// session can't infer left at their empty defaults. Refine it, then call `pack()`.
export function fromAntigravity(rawSession, opts = {}) {
  const { agent, from_session, max_progress = 12 } = opts;

  let messages = structuredMessages(rawSession);
  if (messages.length === 0) messages = proseMessages(rawSession);

  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.text);
  const assistantTexts = messages.filter((m) => m.role === "assistant").map((m) => m.text);

  let goal = userTexts.length ? userTexts[userTexts.length - 1].trim() : "";
  let context = assistantTexts.length ? assistantTexts[assistantTexts.length - 1].trim() : "";

  const seen = new Set();
  const progress = [];
  const addBullets = (t) => {
    for (const b of bulletLines(t)) {
      if (!seen.has(b)) {
        seen.add(b);
        progress.push(b);
      }
    }
  };
  for (const t of assistantTexts) addBullets(t);

  // Marker-less AGENTS.md brief: no user/assistant turns at all. Read it
  // pragmatically — the first heading (or first prose line) is the ask, the next
  // prose line is the background, every bullet is a progress note.
  if (messages.length === 0) {
    const lines = String(rawSession ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const headings = lines
      .map((l) => /^#{1,6}\s+(.*\S)\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => m[1].trim());
    const prose = lines.filter((l) => !/^\s*(?:[-*]|\d+[.)])\s+/.test(l) && !/^#{1,6}\s+/.test(l));
    goal = (headings[0] || prose[0] || "").trim();
    context = (prose[0] && prose[0] !== goal ? prose[0] : prose[1] || "").trim();
    for (const l of lines) addBullets(l);
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
