# handover

**The open format for handing off an in-progress agent task.** When an agent has to stop mid-flight — context window full, session ending, a better-suited model or harness needed, a human stepping away — it writes a *handover packet*: a single portable JSON document capturing everything a fresh agent needs to *resume* the work exactly where it stopped. The goal, the constraints, what's been done, the live working state, what's next, what's still unknown, and the artifacts in play. So an in-progress task can move between agents or harnesses without losing its state. Zero dependencies.

> Working name — see [`vision.md`](vision.md). Grounded in the mid-2026 state of long-running agent tasks.

Long-running agent tasks routinely outlive a single agent. A coding job spans more context than one window holds; a session hits its limit; the work would go faster on a different model; a human hands the thread to a teammate's agent overnight. Coding agents — Claude Code, Codex, Cursor, and Google Antigravity — all hit this wall. Today, when that handoff happens, **the working state evaporates.** The next agent gets a cold transcript (if anything) and re-derives the plan, re-reads the files, re-discovers the decisions already made — or silently drops a half-finished thread. `git blame` doesn't hold it; a chat transcript is lossy and harness-specific; every harness that gestures at "resume" or "session export" does it in its own private, non-portable shape.

> A2A standardizes how one agent *invokes* another. Nothing standardizes the *working state* an agent hands over when it stops mid-task — so every resume starts from scratch.

handover is the missing layer: an open format for the *working state handed over between two agents*, not another orchestrator, memory store, or runtime.

```bash
npx @avee1234/handover pack --goal "add PKCE to login" --agent me   # capture the current handoff
npx @avee1234/handover completeness .handover/packet.json           # is this good enough to resume from?
npx @avee1234/handover resume .handover/packet.json                 # render the briefing for a fresh agent
npx @avee1234/handover diff old.json new.json                       # what did one checkpoint advance over another?
npx @avee1234/handover from-claude-code transcript.jsonl            # draft a packet from a native transcript
```

**Why it's different:** content-addressed, so a packet is self-identifying — its `id` is the sha256 of its content, so any edit produces a new identity and a resumed packet is provably the one that was handed off. It's a **single living document**, not a ledger — no registry to fold, no server to run. Harness-neutral: Claude Code, Codex, Cursor, Google Antigravity, or a factory worker — anything that can run a CLI or import a function.

Same open-format playbook as [opentrajectory](https://github.com/abhid1234/opentrajectory) (traces), [provenant](https://github.com/abhid1234/provenant) (provenance), and [worklease](https://github.com/abhid1234/worklease) (coordination) — the standard for the one thing a mid-task agent handoff currently lacks: *a portable working-state document.*

## The packet format

A handover packet is one JSON document. `id` is the sha256 content hash of the record itself (its own `id` excluded), so a record's identity *is* its content. `goal` and `provenance` are the required spine; every other section is optional but type-checked when present.

```json
{
  "id": "19483d7ee3c50e5f4ee2507643f205e9c6f28bc6f972e04bece928519b4a3374",
  "version": 1,
  "goal": "add PKCE to the OAuth login flow",
  "context": "Zero new deps. The auth module must stay framework-agnostic.",
  "progress": [
    "wrote the PKCE verifier/challenge helpers",
    "wired them into the /authorize handler"
  ],
  "state": {
    "cursor": "src/auth/login.ts:142",
    "approach": "S256 challenge",
    "key_files": ["src/auth/login.ts", "src/auth/pkce.ts"]
  },
  "next_steps": [
    "handle the token-exchange callback",
    "add tests for the verifier"
  ],
  "open_questions": ["should we fall back to plain challenge for legacy clients?"],
  "artifacts": [{ "path": "src/auth/pkce.ts", "note": "new helper module" }],
  "provenance": {
    "handed_off_by": "claude-opus-4-8/claude-code",
    "created": "2026-07-11T12:00:00Z",
    "from_session": "sess-9f21"
  }
}
```

- `goal` — **the task** being handed off (required, non-empty).
- `context` — constraints, background, and decisions the resumer must respect.
- `progress` — what's already been done (array of notes).
- `state` — the live working state (free-form object); an optional `key_files` array names the files to open first.
- `next_steps` — what to do next.
- `open_questions` — what's still unresolved.
- `artifacts` — `{ path, hash?, note? }` for the files produced or touched; `hash` (if present) is the sha256 of the file's bytes.
- `provenance` — **who** handed off (`handed_off_by`), **when** (`created`, ISO-8601-**UTC**, `…Z`; offsets and impossible calendar dates are rejected), and optionally the originating `from_session`.
- `version` — the checkpoint number, incremented by `revise`.

## Library API

Zero-dependency ESM. `import { … } from "@avee1234/handover"`. Every function is pure and clock-injected (no I/O except the packet store), so the whole core is deterministic and unit-testable.

**Schema & validation** — never throw; each returns `{ valid, errors }` collecting *every* violation.
- `validatePacket(obj)` / `validateArtifact(obj)`
- `isSha256Hex(s)`, `isIso8601Utc(s)` — the two format primitives
- `PACKET_FIELDS`, `REQUIRED_SECTIONS`, `ERROR_CODES`

**Construct** — pure packet constructors (throw on bad input rather than emit a malformed packet).
- `pack(input)` → a validated packet with a content-hash id and all section defaults applied. `input` is `{ goal, agent, created, context?, progress?, state?, next_steps?, open_questions?, artifacts?, from_session?, version? }`; `created` is injected (no clock inside).
- `revise(packet, patch)` → a NEW checkpoint: `version` incremented, array sections **appended**, scalar sections (`goal`, `context`) **replaced** when present, `state` shallow-merged, provenance refreshed (`patch.created` required — a revision is a fresh handoff).

**Hash & id** — the content-address primitives.
- `computeId(record)` → the sha256 content hash of a record (its own `id` excluded)
- `canonicalize(record)` → the deterministic hash pre-image (sorted keys, recursive)
- `computeHash(content)` → the sha256 hex of a string/Buffer (an artifact fingerprint for `artifacts[].hash`)

**Assess & render** — pure, total, over a single packet.
- `completeness(packet)` → `{ score, total, present, missing, warnings }` — how much of the handoff a fresh agent has to work with, over the seven `REQUIRED_SECTIONS`, plus plain-language warnings about gaps that strand a resumer.
- `resume(packet)` → the Markdown briefing a fresh agent can be handed verbatim (goal, context, what's done, live state + key files, next steps, open questions, artifacts, and a provenance footer).
- `summarize(packet)` → a one-line status: `"<goal> — N done, M next, K open"`.
- `diffPackets(a, b)` → what checkpoint `b` advanced over `a`: `{ goal_changed, version_delta, progress_added/removed, next_steps_added/removed, questions_opened/closed, artifacts_added/removed, state_keys_changed }` (set semantics on the string arrays — reordering reads as no change).

**Packet store** — the single-document I/O layer.
- `savePacket(path, packet)` → write the packet as pretty JSON (creating its parent dir); overwrites in place — a packet is one living document, not an append log.
- `loadPacket(path)` → the parsed packet (clear throw on a missing file or malformed JSON).
- `defaultPacketPath(cwd)` → `HANDOVER_PACKET`, else `.handover/packet.json`.

**Adapters** — seed a draft packet from a harness's native session artifact so writing one is cheap.
- `fromClaudeCode(rawJsonlTranscript, opts)` → a PARTIAL draft (latest user message → `goal`, last assistant turn → `context`, assistant bullet/numbered lines → `progress`). Pure and tolerant of malformed lines; **not** a validated packet — refine it, then `pack()`.
- `ADAPTERS`, `getAdapter(name)` — the name→builder registry (add new harnesses here).

## CLI

```bash
handover pack [--file <in.json>] [--agent <id>] [--goal "<task>"] [--out <path>] [--json]
handover show <file> [--json]
handover validate <file> [--json]
handover completeness <file> [--json]
handover resume <file>
handover diff <a> <b> [--json]
handover from-claude-code <transcript.jsonl> [--agent <id>] [--json]
```

- **`pack`** — read a JSON object (from `--file` or stdin), fill section defaults, stamp the handoff (agent + timestamp), validate, and write the packet. `--goal` / `--agent` override the input; the clock is read only here. Writes to `--out` (default: `HANDOVER_PACKET`, else `.handover/packet.json`).
- **`show`** — pretty-print a packet (`--json`), or a one-line summary without it.
- **`validate`** — validate a packet against the schema. Exit `0` if valid, `1` otherwise (errors listed with their paths and codes).
- **`completeness`** — score how much of the handoff a fresh agent has to work with, and warn about the gaps that strand a resumer.
- **`resume`** — render the Markdown briefing a fresh agent can be handed verbatim.
- **`diff`** — show what checkpoint `<b>` advanced over checkpoint `<a>`.
- **`from-claude-code`** — parse a Claude Code `.jsonl` transcript into a DRAFT packet to refine and pipe back into `handover pack`.

Common flags: `--agent <id>` (or `HANDOVER_AGENT`), `--out <path>` (or `HANDOVER_PACKET`, default `.handover/packet.json`), `--json` for machine-readable output.

## Install

```bash
npm install @avee1234/handover      # library
npx @avee1234/handover pack …       # CLI, no install
```

Requires Node ≥ 18. Run the test suite with `node --test`.

Status: **v0.1** — see [`roadmap.md`](roadmap.md). MIT · zero dependencies · harness-neutral.
