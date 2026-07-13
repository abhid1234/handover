# handover — vision

*(working name; alts: passoff, relay, taskbaton. Renameable — everything is scoped `@avee1234/handover`.)*

## The one-liner
**The open format for handing off an in-progress agent task.** When an agent has to stop mid-flight — context window full, session ending, a better-suited model or harness needed, a human stepping away — it writes a *handover packet*: a single portable JSON document capturing everything a fresh agent needs to *resume* the work exactly where it stopped. The goal, the constraints, what's been done, the live working state, what's next, what's still unknown, and the artifacts in play. So an in-progress task can move between agents or harnesses without losing its state.

## The problem (mid-2026)
Long-running agent tasks routinely outlive a single agent. A coding job spans more context than one window holds; a session hits its limit; the work would go faster on a different model; a human hands the thread to a teammate's agent overnight. Today, when that handoff happens, **the working state evaporates.** The next agent gets a cold transcript (if anything) and re-derives the plan, re-reads the files, re-discovers the decisions already made — or worse, silently drops a half-finished thread.

> "A2A standardizes how one agent *invokes* another. Nothing standardizes the *working state* an agent hands over when it stops mid-task — so every resume starts from scratch."

`git blame` doesn't hold it. A chat transcript is lossy and harness-specific. Each harness that gestures at "resume" or "session export" does it in its own private, non-portable shape. There is no neutral document you can hand any agent that says: *here is the task, here is how far I got, here is exactly what to do next.*

## The wedge — a handoff format, not a platform
handover is **not** an orchestrator, **not** a memory store, and **not** an agent runtime. It's the thin open layer *between* two agents at the moment work changes hands:

- an open JSON schema for a **packet** — `{ id, version, goal, context, progress[], state, next_steps[], open_questions[], artifacts[], provenance }`
- a **single content-addressed document** (not a ledger) — its `id` is the sha256 of its content, so any edit produces a new identity and a byte-identical copy keeps the old one
- the verbs any harness can call: **`pack`** (capture the current handoff), **`revise`** (checkpoint further progress), **`completeness`** (is this handoff good enough to resume from?), **`resume`** (render a briefing a fresh agent can be handed verbatim), **`diff`** (what did one checkpoint advance over another?)
- adapters that seed a draft packet from a harness's native transcript, so writing one is cheap
- portable by construction — a packet is one JSON file, readable by any agent, with zero dependencies and no server

This is the exact playbook behind [opentrajectory](https://github.com/abhid1234/opentrajectory) (traces), provenant (provenance), worklease (coordination), memport (memory), and selfpatch (self-modification): **own the open interoperability standard, not the runtime.** handover is that standard for the one thing a mid-task agent handoff currently lacks — a portable working-state document.

## Why it's defensible
- **Neutral by construction** — no single agent vendor will build the format that lets a *rival's* agent pick up its unfinished work; a third party is the natural home for the standard.
- **Content-addressed, so a packet is self-identifying** — the `id` is the sha256 of the content, so checkpoints are diffable and a resumed packet is provably the one that was handed off.
- **Small, verifiable surface** — a schema + a pure constructor + a renderer + a diff. The same shape the factory builds and adversarially reviews well.

## The unfair advantage
The author runs a parallel-agent software factory where tasks constantly outlive the agent that started them — context limits, model switches, overnight handoffs. handover's first user, testbed, and demo is the author's own fleet: every dropped or cold-restarted thread is a live bug the format fixes.

## What "done for v0.1" looks like
A `handover` CLI + zero-dep library that lets an agent pack the current task into a validated packet, score whether that packet is complete enough to resume from, render it into a Markdown briefing a fresh agent can be handed verbatim, revise it into a later checkpoint, and diff two checkpoints to see what advanced — plus an adapter that drafts a packet from a Claude Code transcript so writing one is nearly free.

## Non-goals
- Not an orchestrator or scheduler (it captures the handoff; it doesn't route or run the next agent).
- Not a memory system (a packet is one task's working state, not a durable knowledge store — that's memport).
- Not an invocation protocol (A2A covers *calling* an agent; handover covers the *state* handed over when one stops).
