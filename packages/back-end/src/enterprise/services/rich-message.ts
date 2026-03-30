import { randomUUID } from "crypto";
import type { ModelMessage, ToolResultPart } from "ai";
import type { RichMessage } from "shared";
import {
  peekPendingToolArtifact,
  takePendingToolArtifact,
} from "back-end/src/enterprise/services/pending-tool-artifacts";

type AssistantContentPart = Record<string, unknown>;

/**
 * Serializes a rich tool-result into the shape the AI SDK expects on tool messages.
 */
function toolResultOutputFromRich(
  summary: string,
  data: Record<string, unknown>,
) {
  return {
    type: "text" as const,
    value: JSON.stringify({ summary, data }),
  };
}

/**
 * Converts flat RichMessage[] into grouped ModelMessage[] for the LLM.
 */
export function richToModelMessages(messages: RichMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i]!;

    if (m.kind === "user-text") {
      out.push({ role: "user", content: m.content });
      i++;
      continue;
    }

    const assistantParts: AssistantContentPart[] = [];
    while (i < messages.length) {
      const cur = messages[i]!;
      if (cur.kind === "assistant-text") {
        assistantParts.push({ type: "text", text: cur.content });
        i++;
      } else if (cur.kind === "tool-call") {
        assistantParts.push({
          type: "tool-call",
          toolCallId: cur.toolCallId,
          toolName: cur.toolName,
          input: cur.args ?? {},
        });
        i++;
      } else {
        break;
      }
    }

    if (assistantParts.length > 0) {
      out.push({
        role: "assistant",
        content: assistantParts as never,
      });
    }

    const toolParts: ToolResultPart[] = [];
    while (i < messages.length) {
      const cur = messages[i]!;
      if (cur.kind !== "tool-result") break;
      toolParts.push({
        type: "tool-result",
        toolCallId: cur.toolCallId,
        toolName: cur.toolName,
        output: toolResultOutputFromRich(cur.summary, cur.data),
      });
      i++;
    }

    if (toolParts.length > 0) {
      out.push({
        role: "tool",
        content: toolParts,
      });
    }
  }

  return out;
}

/**
 * Replaces tool result payloads from older turns with compact stubs (prefix-stable for prompt caching).
 */
export function compactModelMessagesForLLM(
  messages: ModelMessage[],
): ModelMessage[] {
  let lastAssistantIdx = -1;
  for (let j = messages.length - 1; j >= 0; j--) {
    if (messages[j]!.role === "assistant") {
      lastAssistantIdx = j;
      break;
    }
  }

  return messages.map((msg, idx) => {
    if (idx >= lastAssistantIdx) return msg;

    if (msg.role === "tool") {
      const compactedContent = msg.content.map((part) => {
        if (part.type !== "tool-result") return part;

        let snapshotHint = "";
        const rawOutput = part.output;
        if (
          rawOutput &&
          typeof rawOutput === "object" &&
          "type" in rawOutput &&
          rawOutput.type === "text" &&
          "value" in rawOutput &&
          typeof rawOutput.value === "string"
        ) {
          try {
            const parsed = JSON.parse(rawOutput.value) as {
              data?: { snapshotId?: string };
            };
            const sid = parsed?.data?.snapshotId;
            if (typeof sid === "string") {
              snapshotHint = ` (snapshotId: ${sid})`;
            }
          } catch {
            // ignore
          }
        }

        const stub = `[Result compacted${snapshotHint} — use getSnapshot to retrieve full data]`;
        return {
          ...part,
          output: { type: "text" as const, value: stub },
        } satisfies ToolResultPart;
      });

      return { ...msg, content: compactedContent };
    }

    return msg;
  });
}

export function stripForLLM(messages: RichMessage[]): ModelMessage[] {
  return compactModelMessagesForLLM(richToModelMessages(messages));
}

function resolveToolOutputToRichPayload(
  pending: Record<string, unknown> | undefined,
  output: unknown,
): { summary: string; data: Record<string, unknown> } {
  if (pending) {
    const summary =
      typeof pending.summary === "string"
        ? pending.summary
        : summarizeOutput(output);
    const data = { ...pending };
    delete data.summary;
    return { summary, data };
  }

  if (
    output &&
    typeof output === "object" &&
    "type" in output &&
    (output as { type: string }).type === "text" &&
    "value" in output &&
    typeof (output as { value: unknown }).value === "string"
  ) {
    try {
      const parsed = JSON.parse((output as { value: string }).value) as {
        summary?: string;
        data?: Record<string, unknown>;
      };
      if (parsed && typeof parsed.summary === "string" && parsed.data) {
        return { summary: parsed.summary, data: parsed.data };
      }
      if (parsed && typeof parsed.summary === "string") {
        return {
          summary: parsed.summary,
          data:
            parsed.data && typeof parsed.data === "object"
              ? parsed.data
              : { raw: (output as { value: string }).value },
        };
      }
    } catch {
      // fall through
    }
  }

  return { summary: summarizeOutput(output), data: {} };
}

function parseToolOutputToRich(
  conversationId: string,
  _toolName: string,
  toolCallId: string,
  output: unknown,
): { summary: string; data: Record<string, unknown> } {
  const pending = takePendingToolArtifact(conversationId, toolCallId);
  return resolveToolOutputToRichPayload(pending, output);
}

/** Same as parse after take, but does not remove the pending artifact (for incremental persist). */
export function peekToolOutputToRich(
  conversationId: string,
  _toolName: string,
  toolCallId: string,
  output: unknown,
): { summary: string; data: Record<string, unknown> } {
  const pending = peekPendingToolArtifact(conversationId, toolCallId);
  return resolveToolOutputToRichPayload(pending, output);
}

function summarizeOutput(output: unknown): string {
  if (
    output &&
    typeof output === "object" &&
    "type" in output &&
    (output as { type: string }).type === "text" &&
    "value" in output &&
    typeof (output as { value: unknown }).value === "string"
  ) {
    return (output as { value: string }).value;
  }
  if (typeof output === "string") {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

/**
 * Converts AI SDK response messages for one turn into RichMessage rows.
 * `userMessage` is the rich user row already appended for this request.
 * Skips duplicate `role: user` rows if the SDK echoes the user message.
 */
export function modelMessagesToRich(
  conversationId: string,
  userMessage: RichMessage,
  responseMessages: ModelMessage[],
): RichMessage[] {
  const out: RichMessage[] = [userMessage];
  const now = () => Date.now();

  for (const msg of responseMessages) {
    if (msg.role === "user") {
      continue;
    }

    if (msg.role === "assistant") {
      const content = msg.content;
      if (typeof content === "string") {
        if (content.trim()) {
          out.push({
            kind: "assistant-text",
            id: randomUUID(),
            content,
            ts: now(),
          });
        }
        continue;
      }

      if (!Array.isArray(content)) continue;

      for (const part of content as AssistantContentPart[]) {
        if (
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text
        ) {
          out.push({
            kind: "assistant-text",
            id: randomUUID(),
            content: part.text,
            ts: now(),
          });
        } else if (part.type === "tool-call") {
          const input =
            part.input && typeof part.input === "object" && part.input !== null
              ? (part.input as Record<string, unknown>)
              : undefined;
          out.push({
            kind: "tool-call",
            id: randomUUID(),
            toolName: String(part.toolName ?? ""),
            toolCallId: String(part.toolCallId ?? ""),
            args: input,
            ts: now(),
          });
        }
      }
      continue;
    }

    if (msg.role === "tool") {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type !== "tool-result") continue;
        const toolCallId = part.toolCallId;
        const toolName = part.toolName;
        const { summary, data } = parseToolOutputToRich(
          conversationId,
          toolName,
          toolCallId,
          part.output,
        );
        out.push({
          kind: "tool-result",
          id: randomUUID(),
          toolName,
          toolCallId,
          summary,
          data,
          ts: now(),
        });
      }
    }
  }

  return out;
}
