import type { ModelMessage, ToolResultPart } from "ai";
import {
  toolResultSnapshotId,
  type AIChatAssistantContentPart,
  type AIChatFilePart,
  type AIChatImagePart,
  type AIChatMessage,
  type AIChatUserContentPart,
} from "shared/ai-chat";

function mapMediaPart(p: AIChatImagePart | AIChatFilePart) {
  if (p.type === "image") {
    return { type: "image" as const, image: p.data, mediaType: p.mediaType };
  }
  return { type: "file" as const, data: p.data, mediaType: p.mediaType };
}

function mapUserContent(content: string | AIChatUserContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : mapMediaPart(p),
  );
}

function mapAssistantContent(content: string | AIChatAssistantContentPart[]) {
  if (typeof content === "string") return content;
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
    return mapMediaPart(part);
  });
}

function compactToolOutput(result: string): string {
  const snapshotId = toolResultSnapshotId(result);
  const hint = snapshotId ? ` (snapshotId: ${snapshotId})` : "";
  return `[Result compacted${hint} — use getSnapshot to retrieve full data]`;
}

function mapToolResult(
  part: { toolCallId: string; toolName: string; result: string },
  compact: boolean,
): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: {
      type: "text",
      value: compact ? compactToolOutput(part.result) : part.result,
    },
  };
}

/**
 * Converts AIChatMessage[] to ModelMessage[] for the LLM.
 * Older tool-result payloads (before the last assistant turn) are compacted
 * to save tokens, preserving snapshotId for prompt-cache stability.
 */
export function toModelMessages(messages: AIChatMessage[]): ModelMessage[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  return messages.map((msg, idx): ModelMessage => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };
      case "user":
        return {
          role: "user",
          content: mapUserContent(msg.content),
        } as ModelMessage;
      case "assistant":
        return {
          role: "assistant",
          content: mapAssistantContent(msg.content),
        } as ModelMessage;
      case "tool":
        return {
          role: "tool",
          content: msg.content.map((p) =>
            mapToolResult(p, idx < lastAssistantIdx),
          ),
        };
    }
  });
}
