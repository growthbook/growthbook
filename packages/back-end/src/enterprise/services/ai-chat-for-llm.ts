import type { ModelMessage, ToolResultPart } from "ai";
import {
  toolResultSnapshotId,
  type AIChatAssistantContentPart,
  type AIChatMessage,
  type AIChatUserContentPart,
} from "shared/ai-chat";

function userContentToModel(
  content: string | AIChatUserContentPart[],
): ModelMessage extends { role: "user"; content: infer C } ? C : never {
  if (typeof content === "string") {
    return content as never;
  }
  return content.map((p) => {
    if (p.type === "text") {
      return { type: "text" as const, text: p.text };
    }
    if (p.type === "image") {
      return {
        type: "image" as const,
        image: p.data,
        mediaType: p.mediaType,
      };
    }
    return { type: "file" as const, data: p.data, mediaType: p.mediaType };
  }) as never;
}

function assistantContentToModel(
  content: string | AIChatAssistantContentPart[],
): ModelMessage extends { role: "assistant"; content: infer C } ? C : never {
  if (typeof content === "string") {
    return content as never;
  }
  return content.map((part) => {
    if (part.type === "tool-call") {
      return {
        type: "tool-call" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.args,
      };
    }
    if (part.type === "text") {
      return { type: "text" as const, text: part.text };
    }
    if (part.type === "image") {
      return {
        type: "image" as const,
        image: part.data,
        mediaType: part.mediaType,
      };
    }
    return { type: "file" as const, data: part.data, mediaType: part.mediaType };
  }) as never;
}

/**
 * Converts AIChatMessage[] to ModelMessage[] ready for the LLM.
 * Tool-result payloads for turns before the last assistant message are replaced
 * with a compact stub (preserving snapshotId for prompt-cache stability).
 */
export function stripForLLM(messages: AIChatMessage[]): ModelMessage[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  return messages.map((msg, idx): ModelMessage => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }

    if (msg.role === "user") {
      return { role: "user", content: userContentToModel(msg.content) };
    }

    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: assistantContentToModel(msg.content),
      };
    }

    const compact = idx < lastAssistantIdx;
    return {
      role: "tool",
      content: msg.content.map((part): ToolResultPart => {
        if (compact) {
          const snapshotId = toolResultSnapshotId(part.result);
          const hint = snapshotId ? ` (snapshotId: ${snapshotId})` : "";
          return {
            type: "tool-result" as const,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: {
              type: "text" as const,
              value: `[Result compacted${hint} — use getSnapshot to retrieve full data]`,
            },
          };
        }
        return {
          type: "tool-result" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: {
            type: "text" as const,
            value: part.result,
          },
        };
      }),
    };
  });
}
