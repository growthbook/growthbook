import type { TranscriptEvent } from "./record";

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}… (${s.length - n} more chars)` : s;

// One line per event, with tool payloads clipped and skill bodies left out:
// what the judge reads and what a person skims when a trial fails.
export function renderTranscript(transcript: TranscriptEvent[]): string {
  const skillCalls = new Set(
    transcript.flatMap((e) =>
      e.kind === "tool-call" && e.name === "loadSkill" ? [e.id] : [],
    ),
  );
  return transcript
    .map((e) => {
      switch (e.kind) {
        case "user":
          return `USER: ${e.text}`;
        case "assistant":
          return `ASSISTANT: ${e.text}`;
        case "tool-call":
          return `TOOL CALL ${e.name}: ${clip(JSON.stringify(e.args), 800)}`;
        case "tool-result":
          return skillCalls.has(e.id)
            ? `TOOL RESULT ${e.name}: (skill text omitted)`
            : `TOOL RESULT ${e.name}${e.isError ? " (error)" : ""}: ${clip(JSON.stringify(e.result), 600)}`;
        case "ask":
          return `ASSISTANT asked with buttons: ${e.question} [${e.options.join("] [")}]`;
        case "confirm":
          return `CONFIRMATION CARD for ${e.method} ${e.path}: ${e.summary}`;
        case "decision":
          return `USER clicked ${e.decision === "confirm" ? "Confirm" : "Cancel"}`;
        case "error":
          return `ERROR: ${e.message}`;
      }
    })
    .join("\n");
}
