import type { AIChatMessage, AIChatTextPart } from "shared/ai-chat";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat/types";

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

function assistantMessageCallsAskUser(msg: AIChatMessage): boolean {
  return (
    msg.role === "assistant" &&
    Array.isArray(msg.content) &&
    msg.content.some(
      (part) => part.type === "tool-call" && part.toolName === "askUser",
    )
  );
}

/**
 * Split a turn into intermediate "pre-work" (collapsed behind a toggle) and
 * the user-visible final reply.
 *
 * Preference order:
 *   1. The last assistant message containing plain text — its text is the
 *      reply, everything else is pre-work. Text leading into an `askUser`
 *      question or a pending confirmation stays visible as context for it,
 *      flagged `replyAwaitsUser` so it isn't offered feedback.
 *   2. No reply found, or the turn is still `continuing` (a confirm/cancel
 *      decision resumed it without a new user message) — surface everything
 *      as pre-work so the live steps extend the same drawer.
 */
export function classifyTurn(
  rest: AIChatMessage[],
  {
    awaitingInteraction = false,
    continuing = false,
  }: { awaitingInteraction?: boolean; continuing?: boolean } = {},
): {
  preWork: AIChatMessage[];
  replyContent: string | null;
  replyMessageId: string | null;
  replyIsError: boolean;
  replyAwaitsUser: boolean;
} {
  let lastTextIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (assistantMessageHasText(rest[i])) {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx < 0 || continuing) {
    return {
      preWork: rest,
      replyContent: null,
      replyMessageId: null,
      replyIsError: false,
      replyAwaitsUser: false,
    };
  }
  const endsWithAskUser = rest
    .slice(lastTextIdx)
    .some((message) => assistantMessageCallsAskUser(message));
  const replyMsg = rest[lastTextIdx];
  const preWork = rest.filter((_, i) => i !== lastTextIdx);
  return {
    preWork,
    replyContent: assistantText(replyMsg),
    replyMessageId: replyMsg.id,
    replyIsError: replyMsg.role === "assistant" && replyMsg.isError === true,
    replyAwaitsUser: awaitingInteraction || endsWithAskUser,
  };
}

/**
 * The live text item that introduces an `askUser` question or a pending
 * confirmation. It stays on screen instead of fading into the steps drawer,
 * since it's usually the context the user needs to answer.
 */
export function interactionContextTextId(
  items: ActiveTurnItem[],
  awaitingInteraction: boolean,
): string | null {
  let asksUser = awaitingInteraction;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "text") return asksUser ? item.id : null;
    if (item.kind === "tool-status" && item.toolName === "askUser") {
      asksUser = true;
    }
  }
  return null;
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
