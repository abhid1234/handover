// handover — shared progress cap for the session adapters.
//
// Every adapter infers a `progress` list from a raw session and keeps only the
// most recent `max_progress` items. Doing that with a bare `slice(-max_progress)`
// is subtly wrong: `slice(-0)` is `slice(0)` — it returns EVERYTHING, not none —
// and a negative/fractional/non-numeric cap yields nonsense. This one helper
// makes the cap well-defined for all adapters.

// capProgress(progress, max_progress, fallback=12) → the last `max_progress`
// items of `progress`. `0` → `[]` (none). A non-integer or negative cap falls
// back to `fallback`. A non-array `progress` → `[]`.
export function capProgress(progress, max_progress, fallback = 12) {
  const arr = Array.isArray(progress) ? progress : [];
  let n = max_progress;
  if (!Number.isInteger(n) || n < 0) n = fallback;
  return n === 0 ? [] : arr.slice(-n);
}
