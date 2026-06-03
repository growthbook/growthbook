import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiX, PiPlus, PiArrowLineLeft, PiArrowLineRight } from "react-icons/pi";
import type {
  AIChatMessage,
  AIChatTextPart,
  AIChatToolCallPart,
} from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat/types";
import {
  AssistantBubble,
  UserBubble,
  ErrorBubble,
  ThinkingBubble,
  AIAnalystLabel,
  ToolStatusIcon,
} from "@/enterprise/components/AIChat/AIChatPrimitives";
import CollapsedSteps, {
  type CollapsedStepItem,
} from "@/enterprise/components/AIChat/CollapsedSteps";
import { useCollapsibleActiveTurnItems } from "@/enterprise/components/AIChat/useCollapsibleActiveTurnItems";
import ToolUsageDetails from "@/enterprise/components/AIChat/ToolUsageDetails";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";
import aiChatStyles from "@/enterprise/components/AIChat/AIChatPrimitives.module.scss";
import ChatInputBar from "@/enterprise/components/AIChat/ChatInputBar";
import AgentChatHistory from "./AgentChatHistory";

const STORAGE_KEY = "growthbook.agent.conversationId";

const CALL_API_LABEL = "Calling GrowthBook API…";
const ASK_USER_LABEL = "Asking you a question…";
const LOAD_SKILL_LABEL = "Loading skill…";

const TOOL_STATUS_LABELS: Record<string, string> = {
  callApi: CALL_API_LABEL,
  askUser: ASK_USER_LABEL,
  loadSkill: LOAD_SKILL_LABEL,
};

/**
 * Legacy: older conversations were persisted with a `finalAnswer` tool call
 * carrying the visible reply in `args.content`. New conversations no longer
 * use that tool — the trailing plain-text message is the reply. We still
 * surface the legacy content here so older transcripts render correctly.
 */
const LEGACY_FINAL_ANSWER_TOOL = "finalAnswer";

interface AgentPanelProps {
  open: boolean;
  /** When true, the panel renders at a wider width to give the chat more focus. */
  expanded?: boolean;
  onClose: () => void;
  onToggleExpanded?: () => void;
}

interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

interface AskUserPrompt {
  /** Sequential id so we can detect a fresh question superseding an older one. */
  seq: number;
  question: string;
  options: AskUserOption[];
  allowMultiple: boolean;
  /** Once the user picks (or sends another message), the prompt is resolved. */
  resolved: boolean;
}

interface ConfirmActionPrompt {
  /** Sequential id so a fresh prompt supersedes an older one. */
  seq: number;
  /** Server-issued id for the parked mutation; echoed back on the decision. */
  actionId: string;
  method: string;
  path: string;
  summary: string;
  /** Parsed query params for the parked call, if any. */
  query?: Record<string, unknown>;
  /** Request body for the parked call, if any. */
  body?: unknown;
  /**
   * Once the user decides (or sends another message) the prompt resolves and
   * the card is hidden — the decision plays out in the streamed reply and the
   * persisted "Completed steps", so a lingering card would render out of order.
   */
  resolved: boolean;
}

/** Body fields sent alongside the next message to resolve a parked mutation. */
interface ConfirmDecisionBody {
  confirmActionId: string;
  confirmDecision: "confirm" | "cancel";
}

// ---------------------------------------------------------------------------
// Persisted turn classification
// ---------------------------------------------------------------------------

interface MessageTurn {
  user: AIChatMessage | null;
  rest: AIChatMessage[];
}

function groupMessagesByTurn(messages: AIChatMessage[]): MessageTurn[] {
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

function assistantMessageHasText(msg: AIChatMessage): boolean {
  if (msg.role !== "assistant") return false;
  if (typeof msg.content === "string") return msg.content.trim().length > 0;
  return msg.content.some(
    (p) => p.type === "text" && (p as AIChatTextPart).text.trim().length > 0,
  );
}

function findLegacyFinalAnswer(rest: AIChatMessage[]): string | null {
  for (const msg of rest) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    for (const part of msg.content) {
      if (
        part.type === "tool-call" &&
        (part as AIChatToolCallPart).toolName === LEGACY_FINAL_ANSWER_TOOL
      ) {
        const content = (part as AIChatToolCallPart).args?.content;
        if (typeof content === "string" && content.trim().length > 0) {
          return content;
        }
      }
    }
  }
  return null;
}

/**
 * Split a turn into intermediate "pre-work" (collapsed behind a toggle) and
 * the user-visible final reply.
 *
 * Preference order:
 *   1. Legacy `finalAnswer` tool-call content (old conversations).
 *   2. The last assistant message containing plain text — its text is the
 *      reply, everything else is pre-work.
 *   3. No reply found — surface everything as pre-work (the agent ended the
 *      turn without saying anything visible; usually means it called
 *      `askUser` and the question UI handles display).
 */
function classifyTurn(rest: AIChatMessage[]): {
  preWork: AIChatMessage[];
  replyContent: string | null;
} {
  const legacy = findLegacyFinalAnswer(rest);
  if (legacy !== null) {
    return { preWork: rest, replyContent: legacy };
  }

  let lastTextIdx = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (assistantMessageHasText(rest[i])) {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx < 0) {
    return { preWork: rest, replyContent: null };
  }
  const replyMsg = rest[lastTextIdx];
  const preWork = rest.filter((_, i) => i !== lastTextIdx);
  return { preWork, replyContent: assistantText(replyMsg) };
}

/** Concatenated text from an assistant message (string content or text parts). */
function assistantText(msg: AIChatMessage): string {
  if (msg.role !== "assistant") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p): p is AIChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
}

function persistedToolLabel(toolName: string): string {
  return TOOL_STATUS_LABELS[toolName] ?? toolName;
}

/**
 * Build collapsed-step items for a persisted turn. Assistant text becomes a
 * text step; each tool-result is paired back to its originating tool-call (for
 * the input args) and rendered with an expandable `ToolUsageDetails` block so
 * the user can inspect exactly what was sent and returned.
 *
 * `allMessages` is the turn's full message list (used to resolve tool-call args
 * by id); `openStateRef` preserves each detail block's open/closed state across
 * the active → persisted remount.
 */
function preWorkToSteps(
  preWork: AIChatMessage[],
  allMessages: AIChatMessage[],
  openStateRef: React.MutableRefObject<Record<string, boolean>>,
): CollapsedStepItem[] {
  return preWork.flatMap((msg): CollapsedStepItem[] => {
    if (msg.role === "assistant") {
      const text = assistantText(msg);
      if (!text.trim()) return [];
      return [{ key: msg.id, kind: "text", label: text }];
    }
    if (msg.role === "tool") {
      return msg.content.map((part, i) => {
        const pairedCall = findToolCallPart(allMessages, part);
        return {
          key: `${msg.id}-r${i}`,
          kind: "tool" as const,
          label: persistedToolLabel(part.toolName),
          status: (part.isError ? "error" : "done") as "done" | "error",
          details: (
            <ToolUsageDetails
              toolInput={pairedCall?.args}
              toolOutput={part.result}
              toolCallId={part.toolCallId}
              openStateRef={openStateRef}
            />
          ),
        };
      });
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Site-wide chat panel for the generic GrowthBook agent. Reuses the existing
 * `useAIChat` hook (the same one PA Explorer uses) configured for the
 * `/agent/chat` endpoint family.
 *
 * The active turn renders streaming text/tool items inline. Whenever a new
 * item arrives the previous one is treated as superseded — once complete it
 * fades into the "Completed N steps" drawer. The most recent text bubble
 * therefore reads as the working answer until the model speaks again. When
 * the turn ends, the last plain-text message becomes the persisted reply.
 */
export default function AgentPanel({
  open,
  expanded = false,
  onClose,
  onToggleExpanded,
}: AgentPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const askSeqRef = useRef(0);
  // Preserves each tool-detail disclosure's open/closed state across the
  // active-turn → persisted-message remount so it doesn't snap shut mid-turn.
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});
  const router = useRouter();
  // Read latest pathname inside the callback (not at render) so the URL
  // captured matches where the user is when they hit send, not where they
  // were when the panel rendered.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [askPrompt, setAskPrompt] = useState<AskUserPrompt | null>(null);
  const [confirmPrompt, setConfirmPrompt] =
    useState<ConfirmActionPrompt | null>(null);
  const confirmSeqRef = useRef(0);
  // Holds the decision to attach to the next outgoing message. Consumed (and
  // cleared) by buildRequestBody so it only rides along with one request.
  const pendingDecisionRef = useRef<ConfirmDecisionBody | null>(null);

  // Below this width the left sidebar collapses (see TopNav.module.scss
  // `@media (max-width: 1180px)`), so the docked expanded panel must run to
  // the left edge instead of clearing the 240px sidebar.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1180px)");
    const update = () => setSidebarCollapsed(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Relative links in agent replies navigate the underlying page in-app
  // (the panel stays open) instead of opening a new tab.
  const navigateInApp = useCallback((href: string) => {
    void routerRef.current?.push(href);
  }, []);

  const buildRequestBody = useCallback((message: string, cid: string) => {
    // router.asPath is the path + search (no host); cap to match the
    // back-end validator (z.string().max(2048)).
    const path = (routerRef.current?.asPath ?? "").slice(0, 2048);
    const decision = pendingDecisionRef.current;
    pendingDecisionRef.current = null;
    return {
      message,
      conversationId: cid,
      ...(path ? { currentPage: path } : {}),
      ...(decision ?? {}),
    };
  }, []);

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
  const syncConfirmFromLoad = useCallback((data: unknown) => {
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

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    cancelGeneration,
    newChat,
    loadConversation,
    conversationId,
    loading,
    isLocalStream,
    waitingForNextStep,
    error,
    input,
    setInput,
  } = useAIChat({
    endpoint: "/agent/chat",
    buildRequestBody,
    toolStatusLabels: TOOL_STATUS_LABELS,
    getConversationEndpoint: (cid) => `/agent/chat/${cid}`,
    getCancelEndpoint: (cid) => `/agent/chat/${cid}/cancel`,
    onSSEEvent: handleSSEEvent,
    onConversationLoaded: syncConfirmFromLoad,
    conversationStorageKey: STORAGE_KEY,
  });

  const { collapsedItems, visibleItems } = useCollapsibleActiveTurnItems(
    activeTurnItems,
    displayedTextMap,
  );

  // Focus the composer after a short delay so any slide-in / layout transition
  // settles first. Used on open, new chat, conversation select, and turn end.
  const focusInput = useCallback((delay = 100) => {
    window.setTimeout(() => inputRef.current?.focus(), delay);
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Re-focus the input when a turn finishes (loading true → false) so the user
  // can immediately type a follow-up. The Field is disabled while loading, so
  // focus only takes once it re-enables.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (open && prevLoadingRef.current && !loading) {
      focusInput(0);
    }
    prevLoadingRef.current = loading;
  }, [loading, open, focusInput]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTurnItems]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    if (askPrompt && !askPrompt.resolved) {
      // Typing a free-text reply also resolves the active question.
      setAskPrompt({ ...askPrompt, resolved: true });
    }
    if (confirmPrompt && !confirmPrompt.resolved) {
      // Typing instead of clicking supersedes the parked mutation server-side.
      setConfirmPrompt({ ...confirmPrompt, resolved: true });
    }
    sendMessage();
  }, [input, sendMessage, askPrompt, confirmPrompt]);

  const handleAskOption = useCallback(
    (option: AskUserOption) => {
      if (!askPrompt || askPrompt.resolved || loading) return;
      setAskPrompt({ ...askPrompt, resolved: true });
      sendMessage(option.label);
    },
    [askPrompt, sendMessage, loading],
  );

  const handleConfirmAction = useCallback(
    (decision: "confirm" | "cancel") => {
      if (!confirmPrompt || confirmPrompt.resolved || loading) return;
      setConfirmPrompt({ ...confirmPrompt, resolved: true });
      pendingDecisionRef.current = {
        confirmActionId: confirmPrompt.actionId,
        confirmDecision: decision,
      };
      // The decision is a control signal — don't render it as a user bubble.
      sendMessage(decision === "confirm" ? "Confirm" : "Cancel", {
        suppressUserMessage: true,
      });
    },
    [confirmPrompt, sendMessage, loading],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const resetTransientState = useCallback(() => {
    setAskPrompt(null);
    askSeqRef.current = 0;
    setConfirmPrompt(null);
    confirmSeqRef.current = 0;
    pendingDecisionRef.current = null;
  }, []);

  const handleNewChat = useCallback(() => {
    newChat();
    resetTransientState();
    focusInput();
  }, [newChat, resetTransientState, focusInput]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      void loadConversation(id);
      resetTransientState();
      focusInput();
    },
    [loadConversation, resetTransientState, focusInput],
  );

  if (!open) return null;

  const collapsedActiveSteps = activeItemsToSteps(
    collapsedItems,
    displayedTextMap,
    toolDetailsOpenRef,
  );

  return (
    <Box
      role="dialog"
      aria-label="GrowthBook AI assistant"
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        // Right-anchored, overlapping the navbar. Expanded grows to ~90% of the
        // main content region (100vw minus the 240px sidebar, or full width when
        // the sidebar is collapsed) so a sliver of the page stays visible
        // behind it; collapsed is a lightweight right-edge overlay. Width
        // animates between the two states.
        left: "auto",
        width: expanded
          ? `calc((100vw - ${sidebarCollapsed ? 0 : 240}px) * 0.9)`
          : "min(440px, 100vw)",
        background: "var(--color-background)",
        borderLeft: "1px solid var(--gray-a6)",
        boxShadow: "var(--shadow-5)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9000,
        transition: "width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Header */}
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        style={{
          borderBottom: "1px solid var(--gray-a3)",
          background: "var(--color-panel-solid)",
        }}
      >
        <Flex align="center" gap="3">
          {onToggleExpanded && (
            <IconButton
              variant="ghost"
              size="1"
              onClick={onToggleExpanded}
              title={expanded ? "Collapse panel" : "Expand panel"}
              aria-label={
                expanded ? "Collapse agent panel" : "Expand agent panel"
              }
            >
              {expanded ? (
                <PiArrowLineRight size={16} />
              ) : (
                <PiArrowLineLeft size={16} />
              )}
            </IconButton>
          )}
          <AIAnalystLabel label="AI Assistant" mb="0" />
        </Flex>
        <Flex gap="4">
          <AgentChatHistory
            activeConversationId={conversationId}
            onSelect={handleSelectConversation}
          />
          <IconButton
            variant="ghost"
            size="1"
            onClick={handleNewChat}
            title="Start new conversation"
            aria-label="Start new conversation"
          >
            <PiPlus size={16} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="1"
            onClick={onClose}
            title="Close"
            aria-label="Close agent panel"
          >
            <PiX size={16} />
          </IconButton>
        </Flex>
      </Flex>

      {/* Messages */}
      <Box style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <Flex direction="column" gap="3">
          {messages.length === 0 && !loading && (
            <Text size="small" color="text-low">
              Hi! Ask me to find a metric, build a chart, list features, or run
              an experiment query. I&apos;ll use the GrowthBook REST API to do
              the work.
            </Text>
          )}

          {groupMessagesByTurn(messages).map((turn, idx) => (
            <PersistedTurn
              key={idx}
              turn={turn}
              onInternalLinkClick={navigateInApp}
              toolDetailsOpenRef={toolDetailsOpenRef}
            />
          ))}

          {/* Active turn — most recent item stays in full focus; older
              completed items fade and roll up into the steps drawer. */}
          {collapsedActiveSteps.length > 0 && (
            <CollapsedSteps
              count={collapsedActiveSteps.length}
              items={collapsedActiveSteps}
            />
          )}

          {visibleItems.map(({ item, phase }) => {
            const rendered = (
              <ActiveTurnItemRow
                item={item}
                displayedTextMap={displayedTextMap}
                onInternalLinkClick={navigateInApp}
              />
            );
            const key = item.kind === "tool-status" ? item.toolCallId : item.id;
            return (
              <div
                key={key}
                className={`${aiChatStyles.activeTurnItemWrapper}${phase === "fading" ? ` ${aiChatStyles.collapsingItem}` : ""}`}
              >
                {rendered}
              </div>
            );
          })}

          {(loading || waitingForNextStep) && activeTurnItems.length === 0 && (
            <ThinkingBubble label="Thinking…" />
          )}

          {error && <ErrorBubble>{error}</ErrorBubble>}

          {askPrompt && !askPrompt.resolved && (
            <AssistantBubble>
              <Flex direction="column" gap="2">
                <Text size="small">{askPrompt.question}</Text>
                <Flex direction="column" gap="2">
                  {askPrompt.options.map((opt) => (
                    <AskUserOptionButton
                      key={opt.id}
                      option={opt}
                      disabled={loading}
                      onClick={() => handleAskOption(opt)}
                    />
                  ))}
                </Flex>
              </Flex>
            </AssistantBubble>
          )}

          {confirmPrompt && !confirmPrompt.resolved && (
            <AssistantBubble>
              <Flex direction="column" gap="2">
                <Text size="small" weight="medium">
                  Apply this change?
                </Text>
                <Flex
                  align="center"
                  gap="2"
                  wrap="wrap"
                  style={{
                    padding: "6px 8px",
                    borderRadius: "var(--radius-2)",
                    background: "var(--gray-a3)",
                  }}
                >
                  <MethodPill method={confirmPrompt.method} />
                  <code
                    style={{
                      fontSize: 12,
                      color: "var(--gray-12)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {confirmPrompt.path}
                  </code>
                </Flex>
                {confirmPrompt.summary &&
                  confirmPrompt.summary !==
                    `${confirmPrompt.method} ${confirmPrompt.path}` && (
                    <Text size="small" color="text-low">
                      {confirmPrompt.summary}
                    </Text>
                  )}
                {(confirmPrompt.body !== undefined || confirmPrompt.query) && (
                  <ToolUsageDetails
                    summaryLabel="Request details"
                    toolInput={{
                      method: confirmPrompt.method,
                      path: confirmPrompt.path,
                      ...(confirmPrompt.query
                        ? { query: confirmPrompt.query }
                        : {}),
                      ...(confirmPrompt.body !== undefined
                        ? { body: confirmPrompt.body }
                        : {}),
                    }}
                  />
                )}
                <Text size="small" color="text-low">
                  This is a write to GrowthBook. Confirm to run it, or cancel to
                  keep it from happening.
                </Text>
                <Flex gap="2">
                  <Button
                    size="xs"
                    disabled={loading}
                    onClick={() => handleConfirmAction("confirm")}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={loading}
                    onClick={() => handleConfirmAction("cancel")}
                  >
                    Cancel
                  </Button>
                </Flex>
              </Flex>
            </AssistantBubble>
          )}

          <div ref={messagesEndRef} />
        </Flex>
      </Box>

      {/* Input */}
      <ChatInputBar
        variant="compact"
        inputRef={inputRef}
        input={input}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        onCancel={cancelGeneration}
        loading={loading}
        isLocalStream={isLocalStream}
        placeholder="Ask GrowthBook anything…"
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function activeItemsToSteps(
  items: ActiveTurnItem[],
  displayedTextMap: Map<string, string>,
  openStateRef: React.MutableRefObject<Record<string, boolean>>,
): CollapsedStepItem[] {
  return items.flatMap((item): CollapsedStepItem[] => {
    if (item.kind === "text") {
      const content = displayedTextMap.get(item.id) ?? item.content;
      if (!content) return [];
      return [{ key: item.id, kind: "text", label: content }];
    }
    if (item.kind === "tool-status") {
      return [
        {
          key: item.toolCallId,
          kind: "tool",
          label: item.label,
          status: item.status,
          details: (
            <ToolUsageDetails
              toolInput={item.toolInput}
              argsTextPreview={item.argsTextPreview}
              toolOutput={item.toolOutput}
              toolCallId={item.toolCallId}
              openStateRef={openStateRef}
            />
          ),
        },
      ];
    }
    return [];
  });
}

/**
 * A single active-turn item rendered inline: tool-status pill, streamed text
 * bubble, or thinking placeholder.
 */
function ActiveTurnItemRow({
  item,
  displayedTextMap,
  onInternalLinkClick,
}: {
  item: ActiveTurnItem;
  displayedTextMap: Map<string, string>;
  onInternalLinkClick?: (href: string) => void;
}) {
  if (item.kind === "tool-status") {
    return (
      <Flex align="center" gap="2">
        <ToolStatusIcon status={item.status} />
        <Text size="small" color="text-low">
          {item.label || CALL_API_LABEL}
        </Text>
      </Flex>
    );
  }
  if (item.kind === "text") {
    const displayed = displayedTextMap.get(item.id) ?? item.content;
    if (!displayed) return null;
    return (
      <AssistantBubble>
        <Markdown onInternalLinkClick={onInternalLinkClick}>
          {displayed}
        </Markdown>
      </AssistantBubble>
    );
  }
  if (item.kind === "thinking") {
    return <ThinkingBubble label="Thinking…" />;
  }
  return null;
}

/**
 * Renders a single persisted turn: user bubble (if any), the collapsed
 * "Completed N steps" drawer for intermediate work, then the assistant's
 * visible reply (the last plain-text message, or a legacy `finalAnswer`
 * tool-call's content for older conversations).
 */
function PersistedTurn({
  turn,
  onInternalLinkClick,
  toolDetailsOpenRef,
}: {
  turn: MessageTurn;
  onInternalLinkClick?: (href: string) => void;
  toolDetailsOpenRef: React.MutableRefObject<Record<string, boolean>>;
}) {
  const { preWork, replyContent } = classifyTurn(turn.rest);
  const steps = preWorkToSteps(preWork, turn.rest, toolDetailsOpenRef);

  return (
    <>
      {turn.user && (
        <UserBubble>
          <Text size="small">{getUserText(turn.user)}</Text>
        </UserBubble>
      )}

      {steps.length > 0 && (
        <CollapsedSteps count={steps.length} items={steps} />
      )}

      {replyContent !== null && replyContent.trim() && (
        <AssistantBubble>
          <Markdown onInternalLinkClick={onInternalLinkClick}>
            {replyContent}
          </Markdown>
        </AssistantBubble>
      )}
    </>
  );
}

/**
 * Multi-line "option card" rendered for each `askUser` choice. Uses a native
 * `<button>` instead of the design-system `Button` because the latter is
 * fixed single-line height — two-line label + description content overflows
 * and overlaps. Visual style matches a soft/violet button so it still reads
 * as clickable.
 */
function AskUserOptionButton({
  option,
  disabled,
  onClick,
}: {
  option: AskUserOption;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        borderRadius: "var(--radius-2)",
        border: "1px solid var(--violet-a5)",
        background:
          hover && !disabled ? "var(--violet-a4)" : "var(--violet-a3)",
        color: "var(--violet-12)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        font: "inherit",
        transition: "background 120ms ease",
      }}
    >
      <Flex direction="column" gap="1" align="start">
        <Text size="small" weight="medium">
          {option.label}
        </Text>
        {option.description && (
          <Text size="small" color="text-low">
            {option.description}
          </Text>
        )}
      </Flex>
    </button>
  );
}

/** HTTP-method color mapping for the gated-call pill. */
const METHOD_COLORS: Record<string, { bg: string; fg: string }> = {
  GET: { bg: "var(--blue-a4)", fg: "var(--blue-11)" },
  POST: { bg: "var(--green-a4)", fg: "var(--green-11)" },
  PUT: { bg: "var(--amber-a4)", fg: "var(--amber-11)" },
  PATCH: { bg: "var(--amber-a4)", fg: "var(--amber-11)" },
  DELETE: { bg: "var(--red-a4)", fg: "var(--red-11)" },
};

/** Small colored badge showing the HTTP method of a gated mutation. */
function MethodPill({ method }: { method: string }) {
  const upper = (method || "").toUpperCase();
  const colors = METHOD_COLORS[upper] ?? {
    bg: "var(--gray-a4)",
    fg: "var(--gray-11)",
  };
  return (
    <span
      style={{
        flexShrink: 0,
        padding: "1px 6px",
        borderRadius: "var(--radius-1)",
        background: colors.bg,
        color: colors.fg,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {upper || "?"}
    </span>
  );
}

/** Extract user-visible text from a user message. */
function getUserText(msg: AIChatMessage): string {
  if (msg.role !== "user") return "";
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p): p is AIChatTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
