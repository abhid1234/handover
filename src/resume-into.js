// handover — emit a resume briefing in a harness's opening-context shape.
//
// `resume(packet)` renders the portable Markdown briefing a fresh agent can be
// handed verbatim. But different harnesses take their opening context in different
// SHAPES: one wants a system prompt, another a first user message, another an MCP
// resource. `resumeInto` reuses that same briefing as the body and wraps it in the
// shape the target harness expects — so the one canonical briefing drops straight
// into whichever harness is picking the work up.
//
// Pure and clock-free: it derives everything from the packet and the shape name,
// so the result is fully determined by its inputs. Unlike `resume` (which never
// throws), an unknown shape is a programming error — the caller asked for an
// output this library can't produce — so it throws, exactly like `pack()`.

import { resume } from "./resume.js";

// The opening-context shapes this library knows how to emit.
export const RESUME_SHAPES = ["system-prompt", "user-turn", "mcp-resource"];

// A one-line preamble that frames the briefing for the resuming agent. Shared by
// the system-prompt and user-turn shapes so both open with the same instruction.
const PREAMBLE =
  "You are resuming an in-progress task. A previous agent handed off its working " +
  "state as a handover packet; the briefing below is everything it captured. Pick " +
  "the task up exactly where it stopped — respect the recorded context, honor the " +
  "open questions, and continue from the next steps rather than starting over.";

// resumeInto(packet, harness) → the resume briefing in `harness`'s opening shape:
//
//   'system-prompt' → a system-prompt string (preamble + briefing) to seed the
//                     resuming agent's system context.
//   'user-turn'     → a first-user-message string (preamble + briefing) to open
//                     the resuming agent's conversation.
//   'mcp-resource'  → `{ uri, mimeType: 'text/markdown', text }` — the raw briefing
//                     as an MCP resource the resuming agent can read on demand.
//
// The Markdown body is the real `resume(packet)` output in every shape. An unknown
// harness shape throws a clear Error listing the supported shapes.
export function resumeInto(packet, harness) {
  const briefing = resume(packet);

  switch (harness) {
    case "system-prompt":
      return `${PREAMBLE}\n\n${briefing}`;
    case "user-turn":
      return `${PREAMBLE}\n\n${briefing}`;
    case "mcp-resource": {
      const p = packet && typeof packet === "object" && !Array.isArray(packet) ? packet : {};
      const id = typeof p.id === "string" && p.id ? p.id : "draft";
      return {
        uri: `handover://packet/${id}`,
        mimeType: "text/markdown",
        text: briefing,
      };
    }
    default:
      throw new Error(
        `resumeInto: unknown harness shape "${harness}" — expected one of ${RESUME_SHAPES.join(", ")}`
      );
  }
}
