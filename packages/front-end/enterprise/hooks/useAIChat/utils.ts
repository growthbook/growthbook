import type { MutableRefObject } from "react";
import type { ChatMessage } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawPart = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
};

/**
 * Extracts plain text from a ModelMessage content value.
 * User messages have string content; assistant messages from the Vercel AI SDK
 * use an array of typed parts.
 */
export function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") return content || null;

  if (Array.isArray(content)) {
    const text = (content as RawPart[])
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    return text || null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// hydrateMessages
// ---------------------------------------------------------------------------

/**
 * Converts raw ModelMessage rows from the conversation status API into typed
 * ChatMessages.
 *
 * Assistant messages from the Vercel AI SDK carry an array of typed parts
 * ({ type: "text" } and { type: "tool-call" }). Parts are emitted in the
 * natural order the model produced them, so processing linearly preserves the
 * correct text → tool-call visual sequence.
 *
 * "tool" role messages (tool results) are intentionally skipped here; callers
 * that need artifact data (e.g. charts) should use the `onRawMessages`
 * callback in UseAIChatOptions to process the full raw message list.
 */
export function hydrateMessages(
  raw: unknown[],
  counterRef: MutableRefObject<number>,
  toolStatusLabels: Record<string, string> = {},
): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const m of raw as Array<{ role: string; content: unknown }>) {
    if (m.role === "user") {
      const text = extractTextContent(m.content);
      if (text) {
        result.push({
          id: `msg_${counterRef.current++}`,
          role: "user",
          kind: "text",
          content: text,
        });
      }
    } else if (m.role === "assistant") {
      if (Array.isArray(m.content)) {
        // Process parts in their natural order to preserve the text → tool-call sequence
        for (const part of m.content as RawPart[]) {
          if (part.type === "text" && part.text) {
            result.push({
              id: `msg_${counterRef.current++}`,
              role: "assistant",
              kind: "text",
              content: part.text,
            });
          } else if (part.type === "tool-call" && part.toolCallId) {
            result.push({
              id: `msg_${counterRef.current++}`,
              role: "assistant",
              kind: "tool-call",
              content: "",
              toolLabel:
                toolStatusLabels[part.toolName ?? ""] ??
                part.toolName ??
                "Tool call",
              toolCallId: part.toolCallId,
            });
          }
        }
      } else if (typeof m.content === "string" && m.content) {
        result.push({
          id: `msg_${counterRef.current++}`,
          role: "assistant",
          kind: "text",
          content: m.content,
        });
      }
    }
  }

  return result;
}
