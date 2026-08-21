import { useCallback, useRef, useState } from "react";
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

  /** Mark the question answered; the caller sends `option.label` as the reply. */
  resolveAsk: (option: AskUserOption) => boolean;

  /**
   * Mark the parked mutation decided and stage the decision for the next
   * request. Returns false when there is nothing to decide.
   */
  resolveConfirm: (decision: "confirm" | "cancel") => boolean;

  /** Clear everything — for starting a new conversation. */
  reset: () => void;
}

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
        const question =
          typeof event.data.question === "string" ? event.data.question : "";
        const rawOptions = Array.isArray(event.data.options)
          ? (event.data.options as Array<Record<string, unknown>>)
          : [];
        const options: AskUserOption[] = rawOptions
          .map((o) => ({
            id: typeof o.id === "string" ? o.id : "",
            label: typeof o.label === "string" ? o.label : "",
            description:
              typeof o.description === "string" ? o.description : undefined,
          }))
          .filter((o) => o.id && o.label);
        if (!question || options.length === 0) return;
        askSeqRef.current += 1;
        setAskPrompt({
          seq: askSeqRef.current,
          question,
          options,
          allowMultiple: event.data.allowMultiple === true,
          resolved: false,
        });
        return;
      }
      if (event.type === "confirm-action") {
        const actionId =
          typeof event.data.actionId === "string" ? event.data.actionId : "";
        const method =
          typeof event.data.method === "string" ? event.data.method : "";
        const path = typeof event.data.path === "string" ? event.data.path : "";
        const summary =
          typeof event.data.summary === "string" ? event.data.summary : "";
        const query =
          event.data.query && typeof event.data.query === "object"
            ? (event.data.query as Record<string, unknown>)
            : undefined;
        const body = "body" in event.data ? event.data.body : undefined;
        if (!actionId) return;
        confirmSeqRef.current += 1;
        setConfirmPrompt({
          seq: confirmSeqRef.current,
          actionId,
          method,
          path,
          summary,
          query,
          body,
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
    const pending =
      data && typeof data === "object" && "pendingAction" in data
        ? (data as { pendingAction?: unknown }).pendingAction
        : null;
    if (pending && typeof pending === "object") {
      const p = pending as Record<string, unknown>;
      const actionId = typeof p.id === "string" ? p.id : "";
      if (!actionId) return;
      setConfirmPrompt((prev) => {
        // Already tracking this action (resolved or not) — leave it so we
        // don't re-open a prompt the user just answered.
        if (prev && prev.actionId === actionId) return prev;
        confirmSeqRef.current += 1;
        return {
          seq: confirmSeqRef.current,
          actionId,
          method: typeof p.method === "string" ? p.method : "",
          path: typeof p.path === "string" ? p.path : "",
          summary: typeof p.summary === "string" ? p.summary : "",
          query:
            p.query && typeof p.query === "object"
              ? (p.query as Record<string, unknown>)
              : undefined,
          body: "body" in p ? p.body : undefined,
          resolved: false,
        };
      });
    } else {
      // Server reports no parked action — drop any prompt we were showing.
      setConfirmPrompt((prev) => (prev ? null : prev));
    }
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

  const resolveAsk = useCallback((_option: AskUserOption) => {
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
