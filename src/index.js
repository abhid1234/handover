// handover — public entry point (package `main`).
// Re-exports the pure schema/validator API.
// Re-exports the content-hash id + `computeHash` fingerprint primitives.
// Re-exports the pure `pack` / `revise` packet-constructor API.
// Re-exports the `completeness` handoff-quality scorer.
// Re-exports the `resume` / `summarize` briefing renderers.
// Re-exports the `diffPackets` checkpoint-diff API.
// Re-exports the single-document packet store (`savePacket`, `loadPacket`, …).
// Re-exports the Claude Code transcript adapter (`fromClaudeCode`).

export {
  validatePacket,
  validateArtifact,
  PACKET_FIELDS,
  REQUIRED_SECTIONS,
  ERROR_CODES,
  isIso8601Utc,
  isSha256Hex,
} from "./schema.js";
export { canonicalize, computeId, computeHash } from "./id.js";
export { pack, revise } from "./pack.js";
export { completeness } from "./completeness.js";
export { resume, summarize } from "./resume.js";
export { diffPackets } from "./diff.js";
export { savePacket, loadPacket, defaultPacketPath } from "./io.js";
export { fromClaudeCode } from "./adapters/claude-code.js";
