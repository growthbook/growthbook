import type { ModelMessage, ToolResultPart } from "ai";
import {
  type AIChatAssistantContentPart,
  type AIChatFilePart,
  type AIChatImagePart,
  type AIChatMention,
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
  mentions?: AIChatMention[],
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
  if (mentions && mentions.length) {
    const rendered = mentions
      .map(
        (m) =>
          `${m.name} (${m.type}: ${m.id}${m.stale ? ", STALE — not in this datasource" : ""})`,
      )
      .join(", ");
    lines.push(`[Referenced by the user: ${rendered}]`);
    if (mentions.some((m) => m.stale)) {
      lines.push(
        "[Note: a reference marked STALE was picked under a different datasource and " +
          "cannot be used here. Tell the user it is unavailable in the current datasource, " +
          "name it, and ask them to re-pick it — do not query it or substitute a similar metric.]",
      );
    }
  }
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

function mapUserContent(
  content: string | AIChatUserContentPart[],
  currentPage?: string,
  datasourceHint?: string,
  mentions?: AIChatMention[],
) {
  const prefix = buildContextPrefix(currentPage, datasourceHint, mentions);

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

function mapToolResult(part: {
  toolCallId: string;
  toolName: string;
  result: string;
}): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: {
      type: "text",
      value: part.result,
    },
  };
}

/**
 * Converts AIChatMessage[] to ModelMessage[] for the LLM.
 * Tool results remain intact so token usage can be measured against complete
 * conversation history. Individual tools are responsible for bounding their
 * own responses.
 */
export function toModelMessages(messages: AIChatMessage[]): ModelMessage[] {
  return messages.map((msg): ModelMessage => {
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
            msg.mentions,
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
          content: msg.content.map(mapToolResult),
        };
    }
  });
}
