// handover — render a packet into a resumable briefing.
//
// `resume` turns a packet into a Markdown briefing a fresh agent can be handed
// verbatim as its opening context: the goal, the background it must respect,
// what's already done, the live working state (and the files to open first), what
// to do next, what's still unknown, and the artifacts in play — plus a footer
// citing who handed it off and when. `summarize` is the one-line form for lists.
// Pure and total: both read only the packet and never throw.

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function bulletList(items, empty) {
  const rows = asArray(items).filter((s) => typeof s === "string" && s.trim().length > 0);
  if (rows.length === 0) return `_${empty}_`;
  return rows.map((s) => `- ${s}`).join("\n");
}

// resume(packet) → a Markdown briefing string, sections in reading order. Absent
// or empty sections render an italic placeholder rather than vanishing, so the
// resumer can see what was NOT handed over.
export function resume(packet) {
  const p = isPlainObject(packet) ? packet : {};
  const goal = typeof p.goal === "string" && p.goal.trim() ? p.goal.trim() : "(no goal recorded)";
  const parts = [];

  parts.push(`# Resuming: ${goal}`);

  parts.push("## Context");
  parts.push(typeof p.context === "string" && p.context.trim() ? p.context.trim() : "_none recorded_");

  parts.push("## What's done");
  parts.push(bulletList(p.progress, "nothing recorded yet"));

  parts.push("## Current state");
  const state = isPlainObject(p.state) ? p.state : {};
  const { key_files, ...restState } = state;
  const stateKeys = Object.keys(restState);
  if (stateKeys.length === 0) {
    parts.push("_no working state captured_");
  } else {
    parts.push("```json\n" + JSON.stringify(restState, null, 2) + "\n```");
  }
  const keyFiles = asArray(key_files).filter((f) => typeof f === "string");
  if (keyFiles.length > 0) {
    parts.push("**Key files:**");
    parts.push(keyFiles.map((f) => `- \`${f}\``).join("\n"));
  }

  parts.push("## Next steps");
  parts.push(bulletList(p.next_steps, "none — is the task complete?"));

  parts.push("## Open questions");
  parts.push(bulletList(p.open_questions, "none"));

  parts.push("## Artifacts");
  const artifacts = asArray(p.artifacts).filter((a) => isPlainObject(a) && typeof a.path === "string");
  if (artifacts.length === 0) {
    parts.push("_none listed_");
  } else {
    parts.push(
      artifacts
        .map((a) => {
          const note = a.note ? ` — ${a.note}` : "";
          const hash = a.hash ? ` (\`${String(a.hash).slice(0, 8)}\`)` : "";
          return `- \`${a.path}\`${hash}${note}`;
        })
        .join("\n")
    );
  }

  const prov = isPlainObject(p.provenance) ? p.provenance : {};
  const by = typeof prov.handed_off_by === "string" ? prov.handed_off_by : "unknown agent";
  const at = typeof prov.created === "string" ? prov.created : "unknown time";
  const ver = Number.isInteger(p.version) ? ` · v${p.version}` : "";
  const sess = typeof prov.from_session === "string" ? ` · session ${prov.from_session}` : "";
  parts.push("---");
  parts.push(`_Handed off by ${by} at ${at}${ver}${sess}._`);

  return parts.join("\n\n") + "\n";
}

// summarize(packet) → a one-line status string for listings and logs:
// "<goal> — <n> done, <n> next, <n> open".
export function summarize(packet) {
  const p = isPlainObject(packet) ? packet : {};
  const goal = typeof p.goal === "string" && p.goal.trim() ? p.goal.trim() : "(no goal)";
  const done = asArray(p.progress).length;
  const next = asArray(p.next_steps).length;
  const open = asArray(p.open_questions).length;
  return `${goal} — ${done} done, ${next} next, ${open} open`;
}
