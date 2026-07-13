# handover — roadmap

Built the same way as provenant / constraintguard / worklease / memport / selfpatch: each feature is one GitHub issue → triaged → specced → implemented → adversarially reviewed → shipped, with a human at the gates. Zero dependencies; harness-neutral; a single portable JSON document.

## Design principles
1. **A packet is one portable document.** Not a ledger, not a server record — a single JSON file any agent can read, hand off, and resume from offline.
2. **Content-addressed.** A packet's `id` is the sha256 of its content, so any edit yields a new identity, a byte-identical copy keeps the old one, and two checkpoints are cleanly diffable.
3. **Resumable is the bar.** Schema-valid is not enough — `completeness` grades whether a fresh agent actually has enough to pick the work up, and `resume` renders it into a briefing that agent can be handed verbatim.
4. **Zero-dep, harness-neutral.** Works for Claude Code, Codex, Cursor, or Google Antigravity — anything that can run a CLI or import a function.

## Core (v0.1)

1. **schema** — `validatePacket` / `validateArtifact`. The open shape of a packet: `{ id, version, goal, context, progress[], state, next_steps[], open_questions[], artifacts[], provenance }`. Non-throwing, collects every error. Foundation. *(mirrors the other repos' #1)*

2. **id + pack** — `computeId` content-hashes a packet; `computeHash` fingerprints an artifact's bytes; `pack(input)` builds a validated packet with defaults applied and the handoff stamped; `revise(packet, patch)` checkpoints further progress into a new version. Deterministic; pure core with the clock injected.

3. **completeness** — `completeness(packet)` scores how much of the handoff a fresh agent has to work with: which sections carry real content, which are blank, and plain-language warnings about gaps that strand a resumer.

4. **resume + diff** — `resume(packet)` renders the Markdown briefing a fresh agent can be handed verbatim; `summarize(packet)` is the one-line form; `diffPackets(a, b)` shows what one checkpoint advanced over another. Pure, well-tested, zero-dep.

5. **io** — `savePacket` / `loadPacket` / `defaultPacketPath`. The single-document store: pretty JSON in, parsed packet out, clear errors on a missing or malformed file. No ledger to fold.

## Adapters & ecosystem (v0.2)

6. **Claude Code adapter (dogfood)** — `fromClaudeCode(transcript)` drafts a packet from a `.jsonl` session: latest user message → goal, recent assistant text → context, bullet lines → progress. The user refines the draft and `pack()`s it. Dogfood on the author's own parallel-agent factory.
7. **Codex / Cursor / Google Antigravity adapters** — the same `(raw, opts) → draftPacket` contract for each harness's native session artifact, behind the adapter registry.
8. **`handover resume --into <harness>`** — emit the briefing in each harness's preferred opening-context shape (system prompt, first user turn, MCP resource).
9. **OpenTelemetry bridge** — emit pack/revise/resume events as span attributes (reuse the family pattern).
10. **packet chains** — link a packet to the one it revised (via `provenance`), so a task's full handoff history is walkable like a provenance chain.

## The playground (community hook — priority)
A browser page running the **real** library: an agent works a task, you watch the packet's `completeness` climb as sections fill in, hit "hand off" and see the `resume` briefing a fresh agent would get, then `revise` it and watch the `diff` light up what advanced. Same house style as constraintguard.vercel.app — the visceral "state you can hand to any agent" demo.

## Launch (v0.1 public)
Public repo + green CI + MIT + npm (`@avee1234/handover`) + the playground + a research-grounded README (the "A2A standardizes invocation; nothing standardizes working-state handoff" framing). Then the video/posts kit. Narrative: *long agent tasks outlive the agent that started them; when work changes hands the state evaporates and the next agent restarts cold; here's the open, zero-dep, portable packet that lets any agent resume exactly where the last one stopped.*

## Open design questions (for the human gate)
- **state granularity** — free-form object only, or typed sub-schemas for common working state (open files, cursor, test status)? Leaning: free-form for v0.1, optional typed extensions later.
- **packet history** — a single living document (revise overwrites) vs a kept chain of checkpoints? Leaning: single document for v0.1, with `provenance` able to reference a prior packet id as a v0.2 chain.
- **completeness thresholds** — a raw section score vs a "resumable / not resumable" verdict with a tuned cutoff? Leaning: expose the score + warnings for v0.1, let harnesses set their own bar.
- **artifact bytes** — reference files by path+hash (portable, offline-verifiable) vs optionally embedding small artifacts inline? Leaning: path+hash for v0.1, inline embedding as an opt-in later.
- **first dogfood surface** — a Claude Code session-end hook (closest to home) vs a generic CLI the user runs by hand. Leaning: the adapter + CLI for v0.1, a session-end hook in v0.2.
