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

// The two ways a turn hands control back: `askUser`, and a parked mutation. A
// surface that streams `confirm-action` and renders nothing loses the write.

/** Parsed per-element, so one malformed option drops itself, not the question. */
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

// The SSE event keys the id `actionId`, the persisted action keys it `id`.
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

export function useAgentInteractionPrompts() {
  const [askPrompt, setAskPrompt] = useState<AskUserPrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] =
    useState<ConfirmActionPrompt | null>(null);
  const askSeqRef = useRef(0);
  const confirmSeqRef = useRef(0);
  // Holds the decision to attach to the next outgoing message. Consumed (and
  // cleared) by buildRequestBody so it only rides along with one request.
  const pendingDecisionRef = useRef<ConfirmDecisionBody | null>(null);
  // Mirrors, so the callbacks below stay stable for the memoized send handlers.
  const askRef = useRef<AskUserPrompt | null>(null);
  askRef.current = askPrompt;
  const confirmRef = useRef<ConfirmActionPrompt | null>(null);
  confirmRef.current = confirmPrompt;

  /** Feed every SSE event here; non-interaction events are ignored. */
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

  // Feed the conversation payload on load, so a parked mutation survives a
  // reload. A non-null pendingAction always means "still awaiting" — the server
  // clears it the moment the user confirms or cancels.
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

  /** Consume the decision for the next request; clears, so it rides exactly one. */
  const takePendingDecision = useCallback(() => {
    const decision = pendingDecisionRef.current;
    pendingDecisionRef.current = null;
    return decision;
  }, []);

  /** Answering by typing rather than clicking still settles an open prompt. */
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

  /** Mark the question answered; the caller sends the picked option's label. */
  const resolveAsk = useCallback(() => {
    const ask = askRef.current;
    if (!ask || ask.resolved) return false;
    setAskPrompt({ ...ask, resolved: true });
    return true;
  }, []);

  /** Stage the decision for the next request; false when there is nothing to decide. */
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

  /** Clear everything — for starting a new conversation. */
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
