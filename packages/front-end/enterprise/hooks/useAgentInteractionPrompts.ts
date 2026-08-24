import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import type {
  AskUserOption,
  AskUserPrompt,
} from "@/components/Agent/AskUserCard";
import type {
  ConfirmActionPrompt,
  ConfirmDecisionBody,
} from "@/components/Agent/ConfirmActionCard";

/**
 * The two ways an agent turn ends by handing control back to the user: a
 * multiple-choice question (`askUser`) and a parked mutation awaiting approval
 * (the confirmation gate).
 *
 * Shared by every chat surface that talks to an agent with those tools. A chat
 * that streams `confirm-action` but renders nothing leaves the user with a
 * write that silently never happens, so this must not be reimplemented per
 * surface — one gate, one prompt, one place to get it right.
 */

export interface AgentInteractionPrompts {
  askPrompt: AskUserPrompt | null;
  confirmPrompt: ConfirmActionPrompt | null;

  /** Feed every SSE event here; non-interaction events are ignored. */
  handleSSEEvent: (event: {
    type: string;
    data: Record<string, unknown>;
  }) => void;

  /**
   * Feed the raw conversation payload on load so a mutation parked before a
   * reload comes back up for approval.
   */
  syncFromConversation: (data: unknown) => void;

  /**
   * Consume the decision to attach to the next request. Call from
   * `buildRequestBody` — it clears, so the decision rides exactly one request.
   */
  takePendingDecision: () => ConfirmDecisionBody | null;

  /** Answering by typing rather than clicking still settles an open prompt. */
  resolveOnUserMessage: () => void;

  /** Mark the question answered; the caller sends the picked option's label. */
  resolveAsk: () => boolean;

  /**
   * Mark the parked mutation decided and stage the decision for the next
   * request. Returns false when there is nothing to decide.
   */
  resolveConfirm: (decision: "confirm" | "cancel") => boolean;

  /** Clear everything — for starting a new conversation. */
  reset: () => void;
}

/**
 * A single `askUser` option. Parsed per-element rather than as part of the event
 * so one malformed option drops itself instead of the whole question.
 */
const askOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const askEventSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.unknown()),
  allowMultiple: z.boolean().catch(false),
});

/**
 * The parked mutation, as both places that describe one spell it: the
 * `confirm-action` SSE event keys it `actionId`, the conversation's persisted
 * `pendingAction` keys it `id`. Everything else matches, so the fields are
 * declared once and the id is grafted on per source.
 *
 * `.catch` on the display fields rather than a hard requirement: an action whose
 * summary came back as a number is still an action the user has to decide on,
 * and refusing to render the card would park the write with no way to approve
 * it.
 */
const confirmFieldsSchema = z.object({
  method: z.string().catch(""),
  path: z.string().catch(""),
  summary: z.string().catch(""),
  query: z.record(z.string(), z.unknown()).optional().catch(undefined),
  body: z.unknown().optional(),
});

const confirmEventSchema = confirmFieldsSchema.extend({
  actionId: z.string().min(1),
});

const pendingActionSchema = confirmFieldsSchema
  .extend({ id: z.string().min(1) })
  .transform(({ id, ...rest }) => ({ actionId: id, ...rest }));

export function useAgentInteractionPrompts(): AgentInteractionPrompts {
  const [askPrompt, setAskPrompt] = useState<AskUserPrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] =
    useState<ConfirmActionPrompt | null>(null);
  const askSeqRef = useRef(0);
  const confirmSeqRef = useRef(0);
  // Holds the decision to attach to the next outgoing message. Consumed (and
  // cleared) by buildRequestBody so it only rides along with one request.
  const pendingDecisionRef = useRef<ConfirmDecisionBody | null>(null);
  // Mirrors of the prompts so the callbacks below can stay stable rather than
  // re-creating on every prompt change (they feed memoized send handlers).
  const askRef = useRef<AskUserPrompt | null>(null);
  askRef.current = askPrompt;
  const confirmRef = useRef<ConfirmActionPrompt | null>(null);
  confirmRef.current = confirmPrompt;

  const handleSSEEvent = useCallback(
    (event: { type: string; data: Record<string, unknown> }) => {
      if (event.type === "ask-user") {
        const parsed = askEventSchema.safeParse(event.data);
        if (!parsed.success) return;
        const options: AskUserOption[] = parsed.data.options.flatMap((o) => {
          const option = askOptionSchema.safeParse(o);
          return option.success ? [option.data] : [];
        });
        if (!options.length) return;
        askSeqRef.current += 1;
        setAskPrompt({
          seq: askSeqRef.current,
          question: parsed.data.question,
          options,
          allowMultiple: parsed.data.allowMultiple,
          resolved: false,
        });
        return;
      }
      if (event.type === "confirm-action") {
        const parsed = confirmEventSchema.safeParse(event.data);
        if (!parsed.success) return;
        confirmSeqRef.current += 1;
        setConfirmPrompt({
          seq: confirmSeqRef.current,
          ...parsed.data,
          resolved: false,
        });
      }
    },
    [],
  );

  // When a conversation is (re)loaded from the server, re-render the
  // confirmation prompt from any persisted pending action so a gated request
  // survives a page reload / switching back to the chat. A non-null
  // pendingAction always means "still awaiting" — the server clears it the
  // moment the user confirms or cancels.
  const syncFromConversation = useCallback((data: unknown) => {
    const pending = z
      .object({ pendingAction: pendingActionSchema })
      .safeParse(data);
    if (!pending.success) {
      // No parked action (or nothing usable) — drop any prompt we were showing.
      setConfirmPrompt((prev) => (prev ? null : prev));
      return;
    }
    const action = pending.data.pendingAction;
    setConfirmPrompt((prev) => {
      // Already tracking this action (resolved or not) — leave it so we don't
      // re-open a prompt the user just answered.
      if (prev && prev.actionId === action.actionId) return prev;
      confirmSeqRef.current += 1;
      return { seq: confirmSeqRef.current, ...action, resolved: false };
    });
  }, []);

  const takePendingDecision = useCallback(() => {
    const decision = pendingDecisionRef.current;
    pendingDecisionRef.current = null;
    return decision;
  }, []);

  const resolveOnUserMessage = useCallback(() => {
    const ask = askRef.current;
    if (ask && !ask.resolved) {
      // Typing a free-text reply also resolves the active question.
      setAskPrompt({ ...ask, resolved: true });
    }
    const confirm = confirmRef.current;
    if (confirm && !confirm.resolved) {
      // Typing instead of clicking supersedes the parked mutation server-side.
      setConfirmPrompt({ ...confirm, resolved: true });
    }
  }, []);

  const resolveAsk = useCallback(() => {
    const ask = askRef.current;
    if (!ask || ask.resolved) return false;
    setAskPrompt({ ...ask, resolved: true });
    return true;
  }, []);

  const resolveConfirm = useCallback((decision: "confirm" | "cancel") => {
    const confirm = confirmRef.current;
    if (!confirm || confirm.resolved) return false;
    setConfirmPrompt({ ...confirm, resolved: true });
    pendingDecisionRef.current = {
      confirmActionId: confirm.actionId,
      confirmDecision: decision,
    };
    return true;
  }, []);

  const reset = useCallback(() => {
    setAskPrompt(null);
    askSeqRef.current = 0;
    setConfirmPrompt(null);
    confirmSeqRef.current = 0;
    pendingDecisionRef.current = null;
  }, []);

  return {
    askPrompt,
    confirmPrompt,
    handleSSEEvent,
    syncFromConversation,
    takePendingDecision,
    resolveOnUserMessage,
    resolveAsk,
    resolveConfirm,
    reset,
  };
}
