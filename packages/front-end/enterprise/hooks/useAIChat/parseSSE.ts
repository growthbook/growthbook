import type { SSEEvent } from "./types";

// ---------------------------------------------------------------------------
// SSE parse utility
// ---------------------------------------------------------------------------

export function parseSSEEvents(buffer: string): {
  parsed: SSEEvent[];
  remaining: string;
} {
  const parsed: SSEEvent[] = [];
  const blocks = buffer.split("\n\n");
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventType = "message";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice("event: ".length).trim();
      } else if (line.startsWith("data: ")) {
        const value = line.slice("data: ".length).trim();
        dataStr = dataStr ? dataStr + "\n" + value : value;
      }
    }

    if (dataStr) {
      try {
        const data = JSON.parse(dataStr) as Record<string, unknown>;
        parsed.push({ type: eventType, data });
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  return { parsed, remaining };
}
