import type { ActiveTurnItem, SSEEvent } from "./types";

// ---------------------------------------------------------------------------
// Pure SSE event processor
// ---------------------------------------------------------------------------

export interface SSEProcessResult {
  activeTurnItems?: ActiveTurnItem[];
  waitingForNextStep?: boolean;
  error?: string;
  done?: boolean;
}

/**
 * Maps a single SSE event to state mutations.
 * Pure: no React calls, no side-effects — easy to unit test.
 */
export function processSSEEvent(
  event: SSEEvent,
  currentItems: ActiveTurnItem[],
  toolStatusLabels: Record<string, string>,
  nextId: () => number,
): SSEProcessResult {
  switch (event.type) {
    case "reasoning-delta": {
      const last = currentItems[currentItems.length - 1];
      if (last?.kind === "thinking") {
        return { waitingForNextStep: false };
      }
      return {
        waitingForNextStep: false,
        activeTurnItems: [
          ...currentItems,
          { kind: "thinking", id: `thinking_${nextId()}` },
        ],
      };
    }

    case "text-delta": {
      const content = event.data.content;
      if (typeof content !== "string") return {};

      const withoutThinking =
        currentItems[currentItems.length - 1]?.kind === "thinking"
          ? currentItems.slice(0, -1)
          : currentItems;
      const last = withoutThinking[withoutThinking.length - 1];

      if (last?.kind === "text") {
        return {
          waitingForNextStep: false,
          activeTurnItems: [
            ...withoutThinking.slice(0, -1),
            { ...last, content: last.content + content },
          ],
        };
      }

      return {
        waitingForNextStep: false,
        activeTurnItems: [
          ...withoutThinking,
          { kind: "text", id: `text_${nextId()}`, content },
        ],
      };
    }

    case "tool-call-start": {
      const toolName =
        typeof event.data.toolName === "string" ? event.data.toolName : "";
      const toolCallId =
        typeof event.data.toolCallId === "string"
          ? event.data.toolCallId
          : `tool_${nextId()}`;
      const label = toolStatusLabels[toolName] ?? "Working...";

      return {
        waitingForNextStep: false,
        activeTurnItems: [
          ...currentItems,
          { kind: "tool-status", id: toolCallId, toolCallId, label, status: "running" },
        ],
      };
    }

    case "tool-call-end": {
      const toolCallId =
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";

      return {
        waitingForNextStep: true,
        activeTurnItems: currentItems.map((item) =>
          item.kind === "tool-status" && item.toolCallId === toolCallId
            ? { ...item, status: "done" as const }
            : item,
        ),
      };
    }

    case "error": {
      const msg = event.data.message;
      return { error: typeof msg === "string" ? msg : "An error occurred" };
    }

    case "done":
      return { waitingForNextStep: false, done: true };

    default:
      return {};
  }
}
