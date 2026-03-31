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

      const already = currentItems.some(
        (i) => i.kind === "tool-status" && i.toolCallId === toolCallId,
      );
      if (already) {
        return { waitingForNextStep: false };
      }

      return {
        waitingForNextStep: false,
        activeTurnItems: [
          ...currentItems,
          {
            kind: "tool-status",
            id: toolCallId,
            toolCallId,
            toolName,
            label,
            status: "running",
          },
        ],
      };
    }

    case "tool-call-args-delta": {
      const toolCallId =
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";
      const delta =
        typeof event.data.inputTextDelta === "string"
          ? event.data.inputTextDelta
          : "";
      if (!toolCallId || !delta) return {};

      return {
        waitingForNextStep: false,
        activeTurnItems: currentItems.map((item) =>
          item.kind === "tool-status" && item.toolCallId === toolCallId
            ? {
                ...item,
                argsTextPreview: (item.argsTextPreview ?? "") + delta,
              }
            : item,
        ),
      };
    }

    case "tool-call-input": {
      const toolName =
        typeof event.data.toolName === "string" ? event.data.toolName : "";
      const toolCallId =
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";
      if (!toolCallId || !toolName) return {};

      const label = toolStatusLabels[toolName] ?? "Working...";
      const rawInput = event.data.input;
      const toolInput =
        rawInput &&
        typeof rawInput === "object" &&
        rawInput !== null &&
        !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : undefined;
      const invalid = event.data.invalid === true;
      const errorText =
        typeof event.data.errorText === "string"
          ? event.data.errorText
          : undefined;

      const idx = currentItems.findIndex(
        (i) => i.kind === "tool-status" && i.toolCallId === toolCallId,
      );

      if (idx >= 0) {
        return {
          waitingForNextStep: false,
          activeTurnItems: currentItems.map((item, i) =>
            i === idx && item.kind === "tool-status"
              ? {
                  ...item,
                  toolName,
                  label,
                  toolInput: toolInput ?? item.toolInput,
                  ...(invalid
                    ? {
                        status: "error" as const,
                        errorMessage: errorText ?? "Invalid tool arguments",
                      }
                    : {}),
                }
              : item,
          ),
        };
      }

      return {
        waitingForNextStep: false,
        activeTurnItems: [
          ...currentItems,
          {
            kind: "tool-status",
            id: toolCallId,
            toolCallId,
            toolName,
            label,
            status: invalid ? ("error" as const) : "running",
            ...(toolInput ? { toolInput } : {}),
            ...(invalid
              ? { errorMessage: errorText ?? "Invalid tool arguments" }
              : {}),
          },
        ],
      };
    }

    case "tool-call-end": {
      const toolCallId =
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";
      const toolName =
        typeof event.data.toolName === "string" ? event.data.toolName : "";
      const preliminary = event.data.preliminary === true;
      const hasOutput = "output" in event.data;
      const output = hasOutput ? event.data.output : undefined;
      const rawIn = event.data.input;
      const inputPatch =
        rawIn &&
        typeof rawIn === "object" &&
        rawIn !== null &&
        !Array.isArray(rawIn)
          ? (rawIn as Record<string, unknown>)
          : undefined;

      const toolResultData =
        toolName === "runExploration" &&
        output &&
        typeof output === "object" &&
        !Array.isArray(output) &&
        output !== null &&
        (output as Record<string, unknown>).status === "success" &&
        (() => {
          const ex = (output as Record<string, unknown>).exploration;
          const cfg =
            ex &&
            typeof ex === "object" &&
            ex !== null &&
            "config" in ex &&
            typeof (ex as Record<string, unknown>).config === "object"
              ? (ex as Record<string, unknown>).config
              : undefined;
          return cfg !== undefined;
        })()
          ? (() => {
              const o = output as Record<string, unknown>;
              const data: Record<string, unknown> = {};
              if (typeof o.snapshotId === "string") {
                data.snapshotId = o.snapshotId;
              }
              if (o.exploration !== undefined) {
                data.exploration = o.exploration;
              }
              return data;
            })()
          : undefined;

      return {
        waitingForNextStep: !preliminary,
        activeTurnItems: currentItems.map((item) =>
          item.kind === "tool-status" && item.toolCallId === toolCallId
            ? {
                ...item,
                ...(inputPatch ? { toolInput: inputPatch } : {}),
                ...(hasOutput ? { toolOutput: output } : {}),
                ...(toolResultData ? { toolResultData } : {}),
                ...(!preliminary ? { status: "done" as const } : {}),
              }
            : item,
        ),
      };
    }

    case "tool-call-error": {
      const toolCallId =
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : "";
      const message =
        typeof event.data.message === "string"
          ? event.data.message
          : "Tool failed";
      if (!toolCallId) return {};

      return {
        waitingForNextStep: true,
        activeTurnItems: currentItems.map((item) =>
          item.kind === "tool-status" && item.toolCallId === toolCallId
            ? {
                ...item,
                status: "error" as const,
                errorMessage: message,
              }
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
