import type { AIChatMessage, AIChatTextPart } from "shared/ai-chat";

// ---------------------------------------------------------------------------
// Persisted turn classification
//
// Pure (React-free) helpers for grouping a flat message list into turns and
// splitting each turn into collapsed "pre-work" vs. the visible final reply.
// Kept separate from the component so they can be unit-tested.
// ---------------------------------------------------------------------------

export interface MessageTurn {
  user: AIChatMessage | null;
  rest: AIChatMessage[];
}

export function groupMessagesByTurn(messages: AIChatMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: MessageTurn | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      if (current) turns.push(current);
      current = { user: m, rest: [] };
    } else if (m.role === "assistant" || m.role === "tool") {
      if (!current) current = { user: null, rest: [] };
      current.rest.push(m);
    }
  }
  if (current) turns.push(current);
  return turns;
}

export function assistantMessageHasText(msg: AIChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  if (typeof msg.content === "string") return msg.content.trim().length > 0;
  return msg.content.some(
    (p) => p.type === "text" && (p as AIChatTextPart).text.trim().length > 0,
  );
}

/** Concatenated text from an assistant message (string content or text parts). */
export function assistantText(msg: AIChatMessage): string {
  if (msg.role !== "assistant") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p): p is AIChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
}

/**
 * Split a turn into intermediate "pre-work" (collapsed behind a toggle) and
 * the user-visible final reply.
 *
 * Preference order:
 *   1. The last assistant message containing plain text — its text is the
 *      reply, everything else is pre-work.
 *   2. No reply found — surface everything as pre-work (the agent ended the
 *      turn without saying anything visible; usually means it called
 *      `askUser` and the question UI handles display).
 */
export function classifyTurn(rest: AIChatMessage[]): {
  preWork: AIChatMessage[];
  replyContent: string | null;
  replyMessageId: string | null;
} {
  let lastTextIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (assistantMessageHasText(rest[i])) {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx < 0) {
    return { preWork: rest, replyContent: null, replyMessageId: null };
  }
  const replyMsg = rest[lastTextIdx];
  const preWork = rest.filter((_, i) => i !== lastTextIdx);
  return {
    preWork,
    replyContent: assistantText(replyMsg),
    replyMessageId: replyMsg.id,
  };
}

/** Extract user-visible text from a user message. */
export function getUserText(msg: AIChatMessage): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p): p is AIChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
