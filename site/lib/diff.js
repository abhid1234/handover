// handover — structured diff between two packets.
//
// `diffPackets(a, b)` reports what checkpoint `b` advanced over checkpoint `a`:
// which progress notes, next steps, questions, and artifacts were added or
// removed, whether the goal changed, how far the version moved, and which state
// keys changed value. Set semantics on the string arrays (order-insensitive,
// deduped) so re-ordering the same items reads as no change. Pure and total: it
// reads only the two packets and never throws.

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringSet(v) {
  const out = new Set();
  if (Array.isArray(v)) {
    for (const item of v) if (typeof item === "string") out.add(item);
  }
  return out;
}

// Members of `next` not in `prev`.
function added(prev, next) {
  const p = stringSet(prev);
  return [...stringSet(next)].filter((x) => !p.has(x));
}

// Members of `prev` not in `next`.
function removed(prev, next) {
  const n = stringSet(next);
  return [...stringSet(prev)].filter((x) => !n.has(x));
}

// Artifacts keyed by `path`; added/removed compare the path set, so a re-noted
// artifact at the same path is not counted as churn.
function artifactPaths(v) {
  const out = [];
  if (Array.isArray(v)) {
    for (const a of v) if (isPlainObject(a) && typeof a.path === "string") out.push(a.path);
  }
  return out;
}

// State keys whose JSON value differs between a and b (added, removed, or
// changed). `key_files` is included like any other state key — previously it was
// dropped, which silently hid every change to the files a resumer must read.
function stateKeysChanged(a, b) {
  const sa = isPlainObject(a) ? a : {};
  const sb = isPlainObject(b) ? b : {};
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) changed.push(k);
  }
  return changed.sort();
}

export function diffPackets(a, b) {
  const pa = isPlainObject(a) ? a : {};
  const pb = isPlainObject(b) ? b : {};

  const va = Number.isInteger(pa.version) ? pa.version : 0;
  const vb = Number.isInteger(pb.version) ? pb.version : 0;

  return {
    goal_changed: (pa.goal ?? null) !== (pb.goal ?? null),
    version_delta: vb - va,
    progress_added: added(pa.progress, pb.progress),
    progress_removed: removed(pa.progress, pb.progress),
    next_steps_added: added(pa.next_steps, pb.next_steps),
    next_steps_removed: removed(pa.next_steps, pb.next_steps),
    questions_opened: added(pa.open_questions, pb.open_questions),
    questions_closed: removed(pa.open_questions, pb.open_questions),
    artifacts_added: added(artifactPaths(pa.artifacts), artifactPaths(pb.artifacts)),
    artifacts_removed: removed(artifactPaths(pa.artifacts), artifactPaths(pb.artifacts)),
    state_keys_changed: stateKeysChanged(pa.state, pb.state),
  };
}
