#!/usr/bin/env node
// handover CLI.
//
// Dispatches to subcommands:
//  - `pack`: read a JSON object (stdin or --file), stamp it into a packet, write it.
//  - `show <file>`: pretty-print a packet.
//  - `validate <file>`: print { valid, errors }; exit 1 if invalid.
//  - `completeness <file>`: print the handoff-quality score report.
//  - `resume <file>`: print the Markdown briefing a fresh agent can be handed.
//  - `diff <a> <b>`: print what checkpoint b advanced over checkpoint a.
//  - `from <harness> <file>`: resolve the adapter and print a draft packet.
//  - `from-claude-code <transcript.jsonl>`: shorthand for `from claude-code`.

import { readFileSync } from "node:fs";
import { pack } from "../src/pack.js";
import { validatePacket } from "../src/schema.js";
import { completeness } from "../src/completeness.js";
import { resume, summarize } from "../src/resume.js";
import { diffPackets } from "../src/diff.js";
import { savePacket, loadPacket, defaultPacketPath } from "../src/io.js";
import { getAdapter, ADAPTERS } from "../src/adapters/index.js";

const USAGE = `handover — the open format for handing off an in-progress agent task

Usage:
  handover pack [--file <in.json>] [--agent <id>] [--goal "<task>"]
                [--out <path>] [--json]
      Read a JSON object (from --file or stdin), fill defaults, stamp the
      handoff (agent + timestamp), and write a validated packet. --agent and
      --goal override fields in the input. Writes to --out (default: env
      HANDOVER_PACKET or .handover/packet.json).
  handover show <file> [--json]
      Pretty-print a packet (JSON), or a one-line summary without --json.
  handover validate <file> [--json]
      Validate a packet against the schema. Exit 0 if valid, 1 otherwise.
  handover completeness <file> [--json]
      Score how much of the handoff a fresh agent has to work with.
  handover resume <file>
      Render the Markdown briefing a fresh agent can be handed verbatim.
  handover diff <a> <b> [--json]
      Show what checkpoint <b> advanced over checkpoint <a>.
  handover from <harness> <file> [--agent <id>] [--json]
      Parse a harness's native session artifact into a DRAFT packet to refine and
      then pipe back into \`handover pack\`. <harness> is one of:
      claude-code, codex, cursor, antigravity.
  handover from-<harness> <file> [--agent <id>] [--json]
      Shorthand for \`from <harness> <file>\` (e.g. \`from-claude-code\`).

Flags:
  --file <path>    JSON object to pack (default: stdin)
  --agent <id>     the handing-off agent (env HANDOVER_AGENT)
  --goal <str>     override the packet goal
  --out <path>     where \`pack\` writes (env HANDOVER_PACKET or
                   .handover/packet.json)
  --json           emit machine-readable output for the active command`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// An ISO-8601-UTC timestamp for "now", truncated to whole seconds so the clock
// is read in exactly one place and packets stay tidy.
function nowIso() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// --- pack -------------------------------------------------------------------

function parsePackArgs(args) {
  let file = null;
  let agent = process.env.HANDOVER_AGENT || null;
  let goal = null;
  let out = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--file") {
      file = args[++i];
      if (file == null) fail("error: --file requires a value\n\n" + USAGE);
    } else if (a === "--agent") {
      agent = args[++i];
      if (agent == null) fail("error: --agent requires a value\n\n" + USAGE);
    } else if (a === "--goal") {
      goal = args[++i];
      if (goal == null) fail("error: --goal requires a value\n\n" + USAGE);
    } else if (a === "--out") {
      out = args[++i];
      if (out == null) fail("error: --out requires a value\n\n" + USAGE);
    } else if (a.startsWith("--")) {
      fail(`error: unknown flag: ${a}\n\n` + USAGE);
    } else {
      fail(`error: \`pack\` takes no positional arguments (got: ${a})\n\n` + USAGE);
    }
  }
  return { file, agent, goal, out, json };
}

function runPack(args) {
  const { file, agent, goal, out, json } = parsePackArgs(args);

  const rawInput = file != null ? safeRead(file) : readStdin();
  let input = {};
  if (rawInput && rawInput.trim().length > 0) {
    try {
      input = JSON.parse(rawInput);
    } catch (e) {
      fail(`error: input is not valid JSON — ${e.message}`);
      return;
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      fail("error: input must be a JSON object");
      return;
    }
  }

  // --goal / --agent override the input object; agent falls back to the env var.
  if (goal != null) input.goal = goal;
  if (agent != null) input.agent = agent;

  if (input.agent == null || String(input.agent).trim().length === 0) {
    fail("error: `pack` requires --agent (or the HANDOVER_AGENT env var, or an `agent` field)\n\n" + USAGE);
    return;
  }

  // The clock is read only here; pack stays pure over the injected `created`.
  let packet;
  try {
    packet = pack({ ...input, created: input.created || nowIso() });
  } catch (e) {
    fail(`error: ${e.message}`);
    return;
  }

  const path = out || defaultPacketPath();
  savePacket(path, packet);

  if (json) {
    process.stdout.write(JSON.stringify(packet) + "\n");
  } else {
    process.stdout.write(`packed ${packet.id.slice(0, 8)} → ${path}\n  ${summarize(packet)}\n`);
  }
  process.exit(0);
}

// --- show / validate / completeness / resume --------------------------------

function parseSingleFile(args, name) {
  let file = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") {
      json = true;
    } else if (a.startsWith("--")) {
      fail(`error: unknown flag: ${a}\n\n` + USAGE);
    } else if (file == null) {
      file = a;
    } else {
      fail(`error: \`${name}\` takes a single <file> (extra: ${a})\n\n` + USAGE);
    }
  }
  return { file, json };
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`error: cannot read file: ${path}`);
    return "";
  }
}

function loadOrFail(file) {
  try {
    return loadPacket(file);
  } catch (e) {
    fail(`error: ${e.message}`);
    return null;
  }
}

function runShow(args) {
  const { file, json } = parseSingleFile(args, "show");
  if (file == null) return fail("error: `show` requires a <file> argument\n\n" + USAGE);
  const packet = loadOrFail(file);
  if (json) {
    process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
  } else {
    process.stdout.write(summarize(packet) + "\n");
  }
  process.exit(0);
}

function runValidate(args) {
  const { file, json } = parseSingleFile(args, "validate");
  if (file == null) return fail("error: `validate` requires a <file> argument\n\n" + USAGE);
  const packet = loadOrFail(file);
  const result = validatePacket(packet);

  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else if (result.valid) {
    process.stdout.write("valid ✓\n");
  } else {
    process.stdout.write(
      `invalid ✗ (${result.errors.length} error${result.errors.length === 1 ? "" : "s"}):\n`
    );
    for (const e of result.errors) {
      const at = e.path === "" ? "<root>" : e.path;
      process.stdout.write(`  ${at}: ${e.message} [${e.code}]\n`);
    }
  }
  process.exit(result.valid ? 0 : 1);
}

function runCompleteness(args) {
  const { file, json } = parseSingleFile(args, "completeness");
  if (file == null) return fail("error: `completeness` requires a <file> argument\n\n" + USAGE);
  const packet = loadOrFail(file);
  const report = completeness(packet);

  if (json) {
    process.stdout.write(JSON.stringify(report) + "\n");
    process.exit(0);
  }

  process.stdout.write(
    `completeness ${report.score.toFixed(2)} — ${report.present.length}/${report.total} sections present\n`
  );
  if (report.present.length) process.stdout.write(`  present: ${report.present.join(", ")}\n`);
  if (report.missing.length) process.stdout.write(`  missing: ${report.missing.join(", ")}\n`);
  for (const w of report.warnings) process.stdout.write(`  ! ${w}\n`);
  process.exit(0);
}

function runResume(args) {
  const { file } = parseSingleFile(args, "resume");
  if (file == null) return fail("error: `resume` requires a <file> argument\n\n" + USAGE);
  const packet = loadOrFail(file);
  process.stdout.write(resume(packet));
  process.exit(0);
}

// --- diff -------------------------------------------------------------------

function runDiff(args) {
  const files = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a.startsWith("--")) fail(`error: unknown flag: ${a}\n\n` + USAGE);
    else files.push(a);
  }
  if (files.length !== 2) {
    return fail("error: `diff` requires exactly two <file> arguments\n\n" + USAGE);
  }
  const a = loadOrFail(files[0]);
  const b = loadOrFail(files[1]);
  const d = diffPackets(a, b);

  if (json) {
    process.stdout.write(JSON.stringify(d) + "\n");
    process.exit(0);
  }

  const line = (label, arr) => {
    if (arr.length) process.stdout.write(`  ${label}: ${arr.map((x) => `"${x}"`).join(", ")}\n`);
  };
  process.stdout.write(`diff ${files[0]} → ${files[1]} (version ${d.version_delta >= 0 ? "+" : ""}${d.version_delta})\n`);
  if (d.goal_changed) process.stdout.write("  goal changed\n");
  line("progress +", d.progress_added);
  line("progress -", d.progress_removed);
  line("next +", d.next_steps_added);
  line("next -", d.next_steps_removed);
  line("questions opened", d.questions_opened);
  line("questions closed", d.questions_closed);
  line("artifacts +", d.artifacts_added);
  line("artifacts -", d.artifacts_removed);
  line("state keys changed", d.state_keys_changed);
  process.exit(0);
}

// --- from <harness> ---------------------------------------------------------

// Resolve `harness` in the adapter registry and print a draft packet parsed from
// `file`. Shared by the generic `from` command and the `from-<harness>` shortcuts.
// `label` is what an argument-count error names (the invoked command).
function runFromHarness(harness, args, label) {
  const adapter = getAdapter(harness);
  if (!adapter) {
    const known = Object.keys(ADAPTERS).join(", ");
    return fail(`error: unknown harness: ${harness} (known: ${known})\n\n` + USAGE);
  }

  let file = null;
  let agent = process.env.HANDOVER_AGENT || undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--agent") {
      agent = args[++i];
      if (agent == null) fail("error: --agent requires a value\n\n" + USAGE);
    } else if (a.startsWith("--")) {
      fail(`error: unknown flag: ${a}\n\n` + USAGE);
    } else if (file == null) {
      file = a;
    } else {
      fail(`error: \`${label}\` takes a single <file> (extra: ${a})\n\n` + USAGE);
    }
  }
  if (file == null) {
    return fail(`error: \`${label}\` requires a <file> argument\n\n` + USAGE);
  }

  const raw = safeRead(file);
  const draft = adapter(raw, { agent });

  // A draft prints as JSON either way — it is meant to be edited and piped back
  // into `handover pack`, not read as prose.
  process.stdout.write(JSON.stringify(draft, null, json ? 0 : 2) + "\n");
  process.exit(0);
}

// `from <harness> <file>` — the harness name is the first positional argument.
function runFrom(args) {
  const harness = args[0];
  if (harness == null || harness.startsWith("--")) {
    return fail("error: `from` requires a <harness> argument (e.g. `from claude-code <file>`)\n\n" + USAGE);
  }
  return runFromHarness(harness, args.slice(1), `from ${harness}`);
}

// --- main router ------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (command === "pack") return runPack(args.slice(1));
  if (command === "show") return runShow(args.slice(1));
  if (command === "validate") return runValidate(args.slice(1));
  if (command === "completeness") return runCompleteness(args.slice(1));
  if (command === "resume") return runResume(args.slice(1));
  if (command === "diff") return runDiff(args.slice(1));
  if (command === "from") return runFrom(args.slice(1));
  // `from-<harness>` shorthand (e.g. `from-claude-code`, `from-antigravity`).
  if (typeof command === "string" && command.startsWith("from-")) {
    return runFromHarness(command.slice("from-".length), args.slice(1), command);
  }

  // Unknown / missing subcommand → usage on stderr, exit 1.
  fail(USAGE);
}

main(process.argv);
