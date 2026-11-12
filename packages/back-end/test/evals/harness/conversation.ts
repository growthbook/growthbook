import type { AgentTurn } from "./drivers/driver";

// What the person in the conversation saw and did. The simulated user reads
// only this, never the agent's tool calls.
export type VisibleEvent =
  | { from: "user"; text: string }
  | { from: "user"; decision: "confirm" | "cancel" }
  | { from: "agent"; turn: AgentTurn };

export function renderVisible(events: VisibleEvent[]): string {
  return events
    .map((e) => {
      if (e.from === "user") {
        return "text" in e
          ? `YOU: ${e.text}`
          : `YOU clicked ${e.decision === "confirm" ? "Confirm" : "Cancel"} on the card.`;
      }
      const { turn } = e;
      switch (turn.kind) {
        case "reply":
          return `ASSISTANT: ${turn.text || "(no text)"}`;
        case "ask":
          return `ASSISTANT asked: ${turn.question}\nButtons: ${turn.options.map((o) => `[${o}]`).join(" ")}`;
        case "confirm":
          return `ASSISTANT showed a confirmation card with Confirm and Cancel buttons:\n${turn.summary}`;
        case "error":
          return `ASSISTANT failed with an error: ${turn.message}`;
      }
    })
    .join("\n\n");
}
