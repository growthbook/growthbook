import type { AIChatMessage, AIChatToolCallPart } from "shared/ai-chat";

/**
 * Given a tool-result part's toolCallId, find the matching tool-call part
 * in any assistant message within the conversation.
 */
export function findToolCallPart(
  messages: AIChatMessage[],
  result: { toolCallId: string },
): AIChatToolCallPart | undefined {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const { content } = msg;
    if (typeof content === "string") continue;
    for (const part of content) {
      if (part.type === "tool-call" && part.toolCallId === result.toolCallId) {
        return part;
      }
    }
  }
  return undefined;
}
