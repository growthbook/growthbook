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

/**
 * Build the auto-injected context prefix for a model-bound user message.
 *
 * Each piece of client context is one bracketed line; they're kept off the
 * static system prompt so it stays prompt-cache friendly and instead ride
 * along with the (already per-turn-unique) user message. A trailing blank
 * line separates the prefix from the user's actual text.
 */
function buildContextPrefix(
  currentPage?: string,
  datasourceHint?: string,
): string {
  const lines: string[] = [];
  if (currentPage && currentPage.trim()) {
    lines.push(`[Page context: ${currentPage.trim()}]`);
  }
  if (datasourceHint && datasourceHint.trim()) {
    lines.push(
      `[Active product-analytics datasource: ${datasourceHint.trim()}]`,
    );
  }
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

function mapUserContent(
  content: string | AIChatUserContentPart[],
  currentPage?: string,
  datasourceHint?: string,
) {
  const prefix = buildContextPrefix(currentPage, datasourceHint);

  if (typeof content === "string") {
    return prefix ? `${prefix}${content}` : content;
  }

  const mapped = content.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : mapMediaPart(p),
  );

  if (!prefix) return mapped;

  // Prepend a synthetic text part rather than mutating an existing one so
  // image/file parts stay intact and the prefix is unambiguous to the model.
  return [{ type: "text" as const, text: prefix.trimEnd() }, ...mapped];
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
 * Tool results that must never be compacted, because their content is
 * persistent context the agent needs on every later turn (not a one-off
 * payload it can re-fetch). `loadSkill` returns the skill's endpoint docs and
 * workflow — compacting it makes the agent forget how to call the API and
 * start guessing endpoints, so we always keep it in full.
 */
const NEVER_COMPACT_TOOLS = new Set(["loadSkill"]);

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
          content: mapUserContent(
            msg.content,
            msg.currentPage,
            msg.datasourceHint,
          ),
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
            mapToolResult(
              p,
              idx < lastAssistantIdx && !NEVER_COMPACT_TOOLS.has(p.toolName),
            ),
          ),
        };
    }
  });
}
