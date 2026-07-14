import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPacket } from "../src/io.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "bin", "handover.js");
const CREATED = "2026-07-11T12:00:00Z";
const CREATED2 = "2026-07-11T13:30:00Z";

// Run the CLI as a child process. `input` is fed to stdin. Returns { status, stdout, stderr }.
function run(args, { input = "", env = {} } = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let dir;
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), "handover-cli-"));
});
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name, content) {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

// Pack a packet to a file via the CLI and return its parsed form.
function packFile(name, input) {
  const out = join(dir, name);
  const r = run(["pack", "--out", out, "--json"], { input: JSON.stringify(input) });
  assert.equal(r.status, 0, r.stderr);
  return { out, packet: JSON.parse(r.stdout) };
}

// --- pack -------------------------------------------------------------------

test("pack: reads a JSON object from stdin, stamps a packet, writes it, exit 0", () => {
  const out = join(dir, "p1.json");
  const r = run(["pack", "--out", out], {
    input: JSON.stringify({ goal: "ship parser", agent: "claude", created: CREATED, progress: ["a"] }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /packed/);
  const p = loadPacket(out);
  assert.equal(p.goal, "ship parser");
  assert.equal(p.provenance.handed_off_by, "claude");
  assert.match(p.id, /^[0-9a-f]{64}$/);
});

test("pack --json prints the packet, matching what was written", () => {
  const { out, packet } = packFile("p2.json", { goal: "g", agent: "claude", created: CREATED });
  assert.deepEqual(loadPacket(out), packet);
});

test("pack --goal / --agent override the stdin object", () => {
  const { packet } = packFile("p3.json", { goal: "old", agent: "old-agent", created: CREATED });
  // re-pack with overrides
  const out = join(dir, "p3b.json");
  const r = run(["pack", "--out", out, "--goal", "new goal", "--agent", "new-agent", "--json"], {
    input: JSON.stringify({ goal: "old", agent: "old-agent", created: CREATED }),
  });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.goal, "new goal");
  assert.equal(p.provenance.handed_off_by, "new-agent");
});

test("pack resolves the agent from HANDOVER_AGENT env", () => {
  const out = join(dir, "p4.json");
  const r = run(["pack", "--out", out, "--json"], {
    input: JSON.stringify({ goal: "g", created: CREATED }),
    env: { HANDOVER_AGENT: "env-agent" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).provenance.handed_off_by, "env-agent");
});

test("pack stamps `created` when the input omits it", () => {
  const out = join(dir, "p5.json");
  const r = run(["pack", "--out", out, "--json"], { input: JSON.stringify({ goal: "g", agent: "c" }) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).provenance.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
});

test("pack without an agent (no flag, no env, no field) → error, exit 1", () => {
  const out = join(dir, "p6.json");
  const r = run(["pack", "--out", out], { input: JSON.stringify({ goal: "g", created: CREATED }), env: { HANDOVER_AGENT: "" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /agent/);
  assert.equal(existsSync(out), false);
});

test("pack with invalid input JSON → error, exit 1", () => {
  const r = run(["pack", "--out", join(dir, "bad.json")], { input: "{ not json" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
});

test("pack routes writes through HANDOVER_PACKET when --out is omitted", () => {
  const target = join(dir, "env-out.json");
  const r = run(["pack", "--json"], {
    input: JSON.stringify({ goal: "g", agent: "c", created: CREATED }),
    env: { HANDOVER_PACKET: target },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(target));
});

test("pack --file reads the JSON object from a file", () => {
  const inFile = file("in.json", JSON.stringify({ goal: "from file", agent: "c", created: CREATED }));
  const out = join(dir, "p7.json");
  const r = run(["pack", "--file", inFile, "--out", out, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).goal, "from file");
});

// --- show -------------------------------------------------------------------

test("show: a one-line summary by default, full JSON with --json", () => {
  const { out } = packFile("show1.json", { goal: "ship parser", agent: "c", created: CREATED, progress: ["a", "b"] });
  const human = run(["show", out]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /ship parser — 2 done/);
  const j = run(["show", out, "--json"]);
  assert.equal(j.status, 0);
  assert.equal(JSON.parse(j.stdout).goal, "ship parser");
});

// --- validate ---------------------------------------------------------------

test("validate: a valid packet → exit 0", () => {
  const { out } = packFile("v1.json", { goal: "g", agent: "c", created: CREATED });
  const r = run(["validate", out]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /valid/);
});

test("validate: an invalid packet → exit 1 and lists errors", () => {
  const bad = file("invalid.json", JSON.stringify({ context: "no goal, no provenance" }));
  const r = run(["validate", bad]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /invalid/);
});

test("validate --json emits { valid, errors }", () => {
  const bad = file("invalid2.json", JSON.stringify({ goal: "", provenance: {} }));
  const r = run(["validate", bad, "--json"]);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.valid, false);
  assert.ok(Array.isArray(out.errors) && out.errors.length > 0);
});

// --- completeness -----------------------------------------------------------

test("completeness: prints score + present/missing, exit 0", () => {
  const { out } = packFile("c1.json", {
    goal: "g",
    agent: "c",
    created: CREATED,
    context: "x",
    progress: ["a"],
    state: { cursor: 1 },
    next_steps: ["b"],
    open_questions: ["q"],
    artifacts: [{ path: "f" }],
  });
  const human = run(["completeness", out]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /completeness 1\.00/);
  const j = run(["completeness", out, "--json"]);
  assert.equal(j.status, 0);
  const rep = JSON.parse(j.stdout);
  assert.equal(rep.score, 1);
  assert.equal(rep.total, 7);
});

// --- resume -----------------------------------------------------------------

test("resume: prints the Markdown briefing", () => {
  const { out } = packFile("r1.json", { goal: "ship parser", agent: "c", created: CREATED, next_steps: ["wire CLI"] });
  const r = run(["resume", out]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^# Resuming: ship parser/);
  assert.match(r.stdout, /## Next steps/);
  assert.match(r.stdout, /wire CLI/);
});

// --- diff -------------------------------------------------------------------

test("diff: shows what checkpoint b advanced over a", () => {
  const a = packFile("d-a.json", { goal: "g", agent: "c", created: CREATED, progress: ["a"] }).out;
  const b = packFile("d-b.json", { goal: "g", agent: "c", created: CREATED2, version: 2, progress: ["a", "b"], next_steps: ["x"] }).out;
  const human = run(["diff", a, b]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /progress \+/);
  const j = run(["diff", a, b, "--json"]);
  assert.equal(j.status, 0);
  const d = JSON.parse(j.stdout);
  assert.deepEqual(d.progress_added, ["b"]);
  assert.deepEqual(d.next_steps_added, ["x"]);
  assert.equal(d.version_delta, 1);
});

test("diff requires exactly two files → error, exit 1", () => {
  const a = packFile("d1.json", { goal: "g", agent: "c", created: CREATED }).out;
  const r = run(["diff", a]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /two <file>/);
});

// --- from-claude-code -------------------------------------------------------

test("from-claude-code: prints a draft packet parsed from a .jsonl transcript", () => {
  const transcript = file(
    "t.jsonl",
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "add OAuth" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "- wrote the parser\n- added tests" } }),
    ].join("\n")
  );
  const r = run(["from-claude-code", transcript, "--agent", "claude"]);
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(r.stdout);
  assert.equal(draft.goal, "add OAuth");
  assert.deepEqual(draft.progress, ["wrote the parser", "added tests"]);
  assert.equal(draft.agent, "claude");
  assert.ok(!("id" in draft));
});

test("from-claude-code draft can be piped back into pack", () => {
  const transcript = file(
    "t2.jsonl",
    JSON.stringify({ type: "user", message: { role: "user", content: "the goal" } })
  );
  const draft = JSON.parse(run(["from-claude-code", transcript]).stdout);
  const out = join(dir, "piped.json");
  const r = run(["pack", "--out", out, "--agent", "claude", "--json"], { input: JSON.stringify(draft) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).goal, "the goal");
});

// --- from <harness> ---------------------------------------------------------

test("from <harness>: resolves the adapter from the registry (codex)", () => {
  const rollout = file(
    "codex.jsonl",
    [
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: "add OAuth" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: "- wrote the parser" } }),
    ].join("\n")
  );
  const r = run(["from", "codex", rollout, "--agent", "codex"]);
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(r.stdout);
  assert.equal(draft.goal, "add OAuth");
  assert.deepEqual(draft.progress, ["wrote the parser"]);
  assert.equal(draft.agent, "codex");
});

test("from antigravity: parses an AGENTS.md-style brief into a draft", () => {
  const brief = file("AGENTS.md", ["# Add PKCE to login", "Stay framework-agnostic.", "- wrote the verifier"].join("\n"));
  const r = run(["from", "antigravity", brief]);
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(r.stdout);
  assert.equal(draft.goal, "Add PKCE to login");
  assert.deepEqual(draft.progress, ["wrote the verifier"]);
});

test("from-<harness> shorthand routes through the registry (from-cursor)", () => {
  const session = file("cursor.json", JSON.stringify([{ role: "user", content: "the goal" }]));
  const r = run(["from-cursor", session]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).goal, "the goal");
});

test("from-claude-code still works as a from-<harness> shorthand", () => {
  const transcript = file(
    "t3.jsonl",
    JSON.stringify({ type: "user", message: { role: "user", content: "legacy goal" } })
  );
  const r = run(["from-claude-code", transcript]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).goal, "legacy goal");
});

test("from with an unknown harness → error listing known harnesses, exit 1", () => {
  const anyFile = file("any.jsonl", "{}");
  const r = run(["from", "telepathy", anyFile]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown harness/);
  assert.match(r.stderr, /claude-code/);
});

test("from without a harness argument → error, exit 1", () => {
  const r = run(["from"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a <harness>/);
});

test("from <harness> without a file argument → error, exit 1", () => {
  const r = run(["from", "codex"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a <file>/);
});

// --- router -----------------------------------------------------------------

test("no subcommand → usage on stderr, exit 1", () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage/);
});

test("unknown subcommand → usage on stderr, exit 1", () => {
  const r = run(["frobnicate"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage/);
});

test("an unknown flag → error, exit 1", () => {
  const r = run(["show", join(dir, "x.json"), "--bogus"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/);
});

test("show / validate / completeness / resume require a file argument", () => {
  for (const cmd of ["show", "validate", "completeness", "resume"]) {
    const r = run([cmd]);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /requires a <file>/);
  }
});

test("loading a missing packet file → clear error, exit 1", () => {
  const r = run(["show", join(dir, "nope.json")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no packet at/);
});
