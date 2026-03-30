import type { RichMessage } from "./types";

/**
 * The LLM persists assistant tool-calls in one blob and tool results in the
 * next message, so messages are often [tool-call, tool-call, …, tool-result, …]
 * rather than [tool-call, tool-result, …]. Pair by toolCallId within the same
 * turn (bounded by user-text).
 */

export function toolCallHasPairedResult(
  messages: RichMessage[],
  callIndex: number,
): boolean {
  const msg = messages[callIndex];
  if (msg?.kind !== "tool-call") return false;
  for (let i = callIndex + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.kind === "user-text") break;
    if (
      m.kind === "tool-result" &&
      m.toolCallId === msg.toolCallId &&
      m.toolName === msg.toolName
    ) {
      return true;
    }
  }
  return false;
}

export function pairedToolCallForResult(
  messages: RichMessage[],
  resultIndex: number,
): Extract<RichMessage, { kind: "tool-call" }> | undefined {
  const msg = messages[resultIndex];
  if (msg?.kind !== "tool-result") return undefined;
  for (let k = resultIndex - 1; k >= 0; k--) {
    const m = messages[k]!;
    if (m.kind === "user-text") break;
    if (
      m.kind === "tool-call" &&
      m.toolCallId === msg.toolCallId &&
      m.toolName === msg.toolName
    ) {
      return m;
    }
  }
  return undefined;
}
