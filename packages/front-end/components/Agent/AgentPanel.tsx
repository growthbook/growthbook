import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/router";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiChartLine,
  PiChartLineUp,
  PiFlag,
  PiFlask,
  PiPlus,
  PiSparkle,
  PiX,
} from "react-icons/pi";
import { useSWRConfig } from "swr";
import type { AIChatMessage } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import track from "@/services/track";
import { RadixTheme } from "@/services/RadixTheme";
import { useAuth } from "@/services/auth";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat/types";
import { useDefaultDataSourceId } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  AssistantBubble,
  UserBubble,
  ErrorBubble,
  ToolStatusIcon,
  InlineLinkLoadingIndicator,
} from "@/enterprise/components/AIChat/AIChatPrimitives";
import CollapsedSteps, {
  type CollapsedStepItem,
} from "@/enterprise/components/AIChat/CollapsedSteps";
import { useCollapsibleActiveTurnItems } from "@/enterprise/components/AIChat/useCollapsibleActiveTurnItems";
import { useAutoScroll } from "@/enterprise/components/AIChat/useAutoScroll";
import { useRatchetedMinHeight } from "@/enterprise/components/AIChat/useRatchetedMinHeight";
import ToolUsageDetails from "@/enterprise/components/AIChat/ToolUsageDetails";
import {
  AIChatFeedback,
  type FeedbackState,
} from "@/enterprise/components/AIChat/AIChatFeedback";
import { useChatFeedback } from "@/enterprise/components/AIChat/useChatFeedback";
import MessageTokens from "@/enterprise/components/AIChat/MessageTokens";
import { isWaitingForMarkdownLink } from "@/enterprise/hooks/useAIChat/useTypewriter";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";
import { extractExplorationResultData } from "@/enterprise/hooks/useAIChat/extractExplorationResultData";
import ExplorationBubble, {
  chartDataFromRecord,
} from "@/enterprise/components/ProductAnalytics/AIChat/ExplorationBubble";
import aiChatStyles from "@/enterprise/components/AIChat/AIChatPrimitives.module.scss";
import ChatComposer, {
  type ChatComposerHandle,
  type ComposerSubmission,
} from "@/enterprise/components/AIChat/Composer/ChatComposer";
import { useMetricMentionItems } from "@/enterprise/components/AIChat/Composer/useMetricMentionItems";
import { useSkillMenuItems } from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import { useAgentInteractionPrompts } from "@/enterprise/hooks/useAgentInteractionPrompts";
import AgentChatHistory from "./AgentChatHistory";
import {
  AGENT_PANEL_PORTAL_Z_INDEX,
  AGENT_PANEL_Z_INDEX,
} from "./AgentPanelContext";
import {
  type MessageTurn,
  groupMessagesByTurn,
  classifyTurn,
  assistantText,
  getUserText,
} from "./agentMessageUtils";
import AskUserCard, { type AskUserOption } from "./AskUserCard";
import ConfirmActionCard from "./ConfirmActionCard";
import { dashboardWriteFromEvent } from "./dashboardWrite";
import { resolveAgentInternalHref } from "./agentLinkUtils";

const STORAGE_KEY = "growthbook.agent.conversationId";

const CALL_API_LABEL = "Calling GrowthBook API…";
const ASK_USER_LABEL = "Asking you a question…";
const LOAD_SKILL_LABEL = "Loading skill…";
const WAIT_LABEL = "Waiting…";

function resolveAgentPanelInternalHref(href: string): string | null {
  const currentOrigin =
    typeof window === "undefined" ? null : window.location.origin;
  return resolveAgentInternalHref(href, currentOrigin);
}

const STARTER_PROMPTS = [
  {
    prompt: "Help me understand and analyze my product metrics",
    Icon: PiChartLine,
  },
  {
    prompt: "Show me how my recently started experiments are going",
    Icon: PiChartLineUp,
  },
  { prompt: "Help me create a Feature Flag", Icon: PiFlag },
  { prompt: "Help me create an experiment", Icon: PiFlask },
];

const TOOL_STATUS_LABELS: Record<string, string> = {
  callApi: CALL_API_LABEL,
  askUser: ASK_USER_LABEL,
  loadSkill: LOAD_SKILL_LABEL,
  wait: WAIT_LABEL,
};

const TOOL_PREPARING_LABELS: Record<string, string> = {
  callApi: "Putting together an API request…",
};

interface AgentPanelProps {
  open: boolean;
  /** When true, the panel renders at a wider width to give the chat more focus. */
  expanded?: boolean;
  onClose: () => void;
  onToggleExpanded?: () => void;
}

// ---------------------------------------------------------------------------
// Persisted turn rendering helpers
// ---------------------------------------------------------------------------

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
      return msg.content.flatMap((part, i): CollapsedStepItem[] => {
        const pairedCall = findToolCallPart(allMessages, part);
        const resultData = extractExplorationResultData(
          part.toolName,
          pairedCall?.args,
          part.result,
        );
        if (resultData && chartDataFromRecord(resultData)) return [];
        return [
          {
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
          },
        ];
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
  const composerRef = useRef<ChatComposerHandle>(null);
  // Preserves each tool-detail disclosure's open/closed state across the
  // active-turn → persisted-message remount so it doesn't snap shut mid-turn.
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});
  const stepsExpandedRef = useRef(false);
  const router = useRouter();
  const { defaultAIModel } = useAISettings();
  // Read latest pathname inside the callback (not at render) so the URL
  // captured matches where the user is when they hit send, not where they
  // were when the panel rendered.
  const routerRef = useRef(router);
  routerRef.current = router;
  // The general agent runs site-wide (outside the PA ExplorerProvider), so we
  // read the user's last-selected product-analytics datasource from the shared
  // localStorage-backed hook. Captured in a ref and read at send time (like the
  // router path) so buildRequestBody stays stable and reflects the latest value.
  const datasourceId = useDefaultDataSourceId();
  const datasourceIdRef = useRef(datasourceId);
  datasourceIdRef.current = datasourceId;
  const {
    askPrompt,
    confirmPrompt,
    handleSSEEvent,
    syncFromConversation,
    takePendingDecision,
    resolveOnUserMessage,
    resolveAsk,
    resolveConfirm,
    reset: resetTransientState,
  } = useAgentInteractionPrompts();
  const pendingSubmissionRef = useRef<ComposerSubmission>({
    text: "",
    mentions: [],
    skills: [],
  });

  const { items: mentionItems, ready: mentionItemsReady } =
    useMetricMentionItems();
  const skillItems = useSkillMenuItems();

  const {
    feedbackMap,
    handleFeedbackSubmit,
    loadFeedbackFromConversation,
    clearFeedback,
    conversationIdRef: feedbackConversationIdRef,
  } = useChatFeedback("/agent/chat");

  // Below this width the left sidebar collapses (see TopNav.module.scss
  // `@media (max-width: 1180px)`), so the docked expanded panel must run to
  // the left edge instead of clearing the 240px sidebar.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Portaled to body so the panel stacks against body-portaled page controls
  // instead of being sealed inside the root theme's stacking context. Tradeoff:
  // #portal-root stays sealed, so legacy modals render under an open panel.
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalHost(document.body), []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1180px)");
    const update = () => setSidebarCollapsed(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const { mutate } = useSWRConfig();
  const { orgId } = useAuth();

  /**
   * Every cached dashboard in THIS org is stale once the agent has written one.
   * useApi keys are `<orgId>::<path>`, so the prefix keeps orgs the user visited
   * earlier in the session out of the revalidation.
   */
  const mutateDashboards = useCallback(
    () =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(`${orgId}::/dashboards`),
      ),
    [mutate, orgId],
  );

  /**
   * A dashboard write only needs the caches dropped: the PUT already ran the
   * charts it affected (and a metadata-only edit has none to run), so calling
   * the refresh endpoint here would re-run those warehouse queries.
   */
  const handleDashboardWrite = useCallback(
    (event: { type: string; data: Record<string, unknown> }) => {
      if (!dashboardWriteFromEvent(event)) return;
      void mutateDashboards();
    },
    [mutateDashboards],
  );

  const handleAgentSSEEvent = useCallback(
    (event: { type: string; data: Record<string, unknown> }) => {
      handleSSEEvent(event);
      handleDashboardWrite(event);
    },
    [handleSSEEvent, handleDashboardWrite],
  );

  const buildRequestBody = useCallback(
    (message: string, cid: string) => {
      // router.asPath is the path + search (no host); cap to match the
      // back-end validator (z.string().max(2048)).
      const path = (routerRef.current?.asPath ?? "").slice(0, 2048);
      const dsId = datasourceIdRef.current;
      const decision = takePendingDecision();
      const { mentions, skills } = pendingSubmissionRef.current;
      pendingSubmissionRef.current = { text: "", mentions: [], skills: [] };
      return {
        message,
        conversationId: cid,
        ...(path ? { currentPage: path } : {}),
        ...(dsId ? { datasourceId: dsId } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(skills.length ? { skills } : {}),
        ...(decision ?? {}),
      };
    },
    [takePendingDecision],
  );

  // On load, hydrate both the parked confirmation prompt and any persisted
  // message feedback from the same raw conversation payload.
  const handleConversationLoaded = useCallback(
    (data: unknown) => {
      syncFromConversation(data);
      loadFeedbackFromConversation(data);
      // Switching conversations aborts the live stream while the server keeps
      // going, so a dashboard write can land with nobody listening for its
      // event. Resyncing a conversation is the first moment we could have
      // missed one, so drop the caches then too.
      void mutateDashboards();
    },
    [syncFromConversation, loadFeedbackFromConversation, mutateDashboards],
  );

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
    isLoadingConversation,
    isLocalStream,
    waitingForNextStep,
    error,
    input,
    setInput,
  } = useAIChat({
    endpoint: "/agent/chat",
    buildRequestBody,
    toolStatusLabels: TOOL_STATUS_LABELS,
    toolPreparingLabels: TOOL_PREPARING_LABELS,
    pauseIncompleteMarkdownLinks: true,
    getConversationEndpoint: (cid) => `/agent/chat/${cid}`,
    getCancelEndpoint: (cid) => `/agent/chat/${cid}/cancel`,
    onSSEEvent: handleAgentSSEEvent,
    onConversationLoaded: handleConversationLoaded,
    conversationStorageKey: STORAGE_KEY,
    onMessageComplete: (info) => {
      track("AI Assistant Response Completed", {
        model: defaultAIModel,
        durationMs: info.durationMs,
        toolCallCount: info.toolCallCount,
      });
    },
    onMessageCancelled: (info) => {
      track("AI Assistant Generation Cancelled", {
        model: defaultAIModel,
        durationMs: info.durationMs,
      });
    },
    onMessageError: (info) => {
      track("AI Assistant Error", {
        errorType: info.errorType,
        httpStatus: info.httpStatus,
      });
    },
  });

  // Keep the feedback hook's ref in sync with the current conversation id.
  // The ref is only read inside event handlers, never during render.
  feedbackConversationIdRef.current = conversationId;

  // Panel stays mounted while closed; listeners need the container to exist.
  const { scrollContainerRef, handleScroll, resumeAutoScroll } = useAutoScroll({
    messages,
    activeTurnItems,
    displayedTextMap,
    conversationId,
    enabled: open,
  });

  const { ref: activeTurnRef, minHeight: activeTurnMinHeight } =
    useRatchetedMinHeight(loading);

  const { collapsedItems, visibleItems, fadingTextIds } =
    useCollapsibleActiveTurnItems(activeTurnItems, displayedTextMap, {
      fadeSupersededText: true,
      isPinned: (item) =>
        item.kind === "tool-status" &&
        item.status === "done" &&
        !!item.toolResultData &&
        chartDataFromRecord(item.toolResultData) !== null,
    });

  // Focus the composer after a short delay so any layout transition settles
  // first. Used on new chat, conversation select, and turn end — opening the
  // panel remounts the composer, so that case is its own `autoFocus`.
  const focusInput = useCallback((delay = 100) => {
    window.setTimeout(() => composerRef.current?.focus(), delay);
  }, []);

  // Re-focus the input when a turn finishes (loading true → false) so the user
  // can immediately type a follow-up. The composer is read-only while loading,
  // so focus only takes once it re-enables.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (open && prevLoadingRef.current && !loading) {
      focusInput(0);
    }
    prevLoadingRef.current = loading;
  }, [loading, open, focusInput]);

  const trackMessageSent = useCallback(() => {
    track("AI Assistant Message Sent", {
      model: defaultAIModel,
      messageCount: messages.length,
      isFirstMessage: messages.length === 0,
    });
  }, [defaultAIModel, messages.length]);

  const handleStepsToggle = useCallback((expanded: boolean) => {
    stepsExpandedRef.current = expanded;
  }, []);

  const handleSend = useCallback(
    (
      submission: ComposerSubmission = {
        text: input,
        mentions: [],
        skills: [],
      },
    ) => {
      const text = submission.text.trim();
      if (!text || loading) return;
      stepsExpandedRef.current = false;
      pendingSubmissionRef.current = submission;
      resolveOnUserMessage();
      resumeAutoScroll();
      trackMessageSent();
      sendMessage(text, {
        mentions: submission.mentions,
        skills: submission.skills,
      });
    },
    [
      input,
      loading,
      sendMessage,
      resolveOnUserMessage,
      resumeAutoScroll,
      trackMessageSent,
    ],
  );

  const handleStarterPrompt = useCallback(
    (prompt: string) => {
      setInput(prompt);
      focusInput(0);
    },
    [focusInput, setInput],
  );

  const handleAskOption = useCallback(
    (option: AskUserOption) => {
      if (loading || !resolveAsk()) return;
      resumeAutoScroll();
      trackMessageSent();
      sendMessage(option.label);
    },
    [resolveAsk, sendMessage, loading, resumeAutoScroll, trackMessageSent],
  );

  const handleConfirmAction = useCallback(
    (decision: "confirm" | "cancel") => {
      if (loading || !resolveConfirm(decision)) return;
      resumeAutoScroll();
      // The decision is a control signal — don't render it as a user bubble.
      trackMessageSent();
      sendMessage(decision === "confirm" ? "Confirm" : "Cancel", {
        suppressUserMessage: true,
      });
    },
    [resolveConfirm, sendMessage, loading, resumeAutoScroll, trackMessageSent],
  );

  const handleNewChat = useCallback(() => {
    track("AI Assistant New Conversation", {
      previousConversationMessageCount: messages.length,
    });
    stepsExpandedRef.current = false;
    newChat();
    resetTransientState();
    clearFeedback();
    focusInput();
  }, [
    messages.length,
    newChat,
    resetTransientState,
    clearFeedback,
    focusInput,
  ]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      track("AI Assistant Load Conversation");
      stepsExpandedRef.current = false;
      void loadConversation(id);
      resetTransientState();
      focusInput();
    },
    [loadConversation, resetTransientState, focusInput],
  );

  if (!open || !portalHost) return null;

  const latestActivityItem = [...visibleItems]
    .reverse()
    .find(
      (item) =>
        item.kind === "thinking" ||
        (item.kind === "tool-status" &&
          !(
            item.status === "done" &&
            item.toolResultData &&
            chartDataFromRecord(item.toolResultData)
          )),
    );
  const foldLatestActivity =
    waitingForNextStep && latestActivityItem?.kind === "tool-status";
  const activityItems = foldLatestActivity
    ? [...collapsedItems, latestActivityItem]
    : collapsedItems;
  const collapsedActiveSteps = activeItemsToSteps(
    activityItems,
    displayedTextMap,
    toolDetailsOpenRef,
  );
  const activeStatus = waitingForNextStep
    ? {
        key: "reviewing-results",
        label: "Reviewing results…",
        status: "running" as const,
      }
    : latestActivityItem?.kind === "tool-status"
      ? {
          key: latestActivityItem.toolCallId,
          label: latestActivityItem.label || CALL_API_LABEL,
          status: latestActivityItem.status,
        }
      : latestActivityItem?.kind === "thinking"
        ? {
            key: latestActivityItem.id,
            label: "Thinking…",
            status: "running" as const,
          }
        : loading && activeTurnItems.length === 0
          ? {
              key: "thinking",
              label: "Thinking…",
              status: "running" as const,
            }
          : null;
  const persistedTurns = groupMessagesByTurn(messages);
  const confirmationPending =
    confirmPrompt !== null && (!confirmPrompt.resolved || loading);
  const interactionPending =
    (askPrompt !== null && !askPrompt.resolved) || confirmationPending;

  const panel = (
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
          : "min(400px, 100vw)",
        background: "var(--color-background)",
        borderLeft: "1px solid var(--gray-a3)",
        boxShadow: "-8px 0 24px var(--black-a4)",
        display: "flex",
        flexDirection: "column",
        zIndex: AGENT_PANEL_Z_INDEX,
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
          <Flex
            align="center"
            justify="center"
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              background: "var(--violet-a4)",
              borderRadius: "999px",
            }}
          >
            <PiSparkle size={16} color="var(--violet-11)" />
          </Flex>
          <Heading as="h2" size="xs">
            AI Assistant
          </Heading>
        </Flex>
        <Flex align="center" gap="3">
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
            <PiPlus size={18} />
          </IconButton>
          {onToggleExpanded && (
            <IconButton
              variant="ghost"
              size="1"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onToggleExpanded}
              title={expanded ? "Minimize panel" : "Maximize panel"}
              aria-label={
                expanded ? "Minimize agent panel" : "Maximize agent panel"
              }
            >
              {expanded ? (
                <PiArrowsInSimple size={18} />
              ) : (
                <PiArrowsOutSimple size={18} />
              )}
            </IconButton>
          )}
          <IconButton
            variant="ghost"
            size="1"
            onClick={onClose}
            title="Close"
            aria-label="Close agent panel"
          >
            <PiX size={18} />
          </IconButton>
        </Flex>
      </Flex>

      {/* Messages */}
      <Box
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: "auto", padding: "20px" }}
      >
        <Flex direction="column" gap="3">
          {messages.length === 0 &&
            !loading &&
            !isLoadingConversation &&
            !error && (
              <Flex
                direction="column"
                gap="5"
                style={{
                  alignSelf: "flex-start",
                  width: expanded ? "100%" : "min(640px, 100%)",
                }}
              >
                <Box
                  p="4"
                  style={{
                    border: "1px solid var(--violet-a3)",
                    borderRadius: "var(--radius-3)",
                    background: "var(--gray-a2)",
                  }}
                >
                  <Flex direction="column" gap="3">
                    <Text size="md" weight="semibold">
                      Hey there! 👋
                    </Text>
                    <Text size="md" color="text-mid">
                      I&apos;m your AI Assistant. I have access to your
                      experiments, Feature Flags, metrics, and database schemas.
                      Let me know what you&apos;d like to build or explore
                      today!
                    </Text>
                  </Flex>
                </Box>
                <Flex direction="column" gap="2">
                  <Heading as="h3" size="xs" color="text-low">
                    Suggestions
                  </Heading>
                  <Grid columns={expanded ? "2" : "1"} gap="2">
                    {STARTER_PROMPTS.map(({ prompt, Icon }) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        color="gray"
                        size="sm"
                        icon={
                          <Flex
                            align="center"
                            justify="center"
                            style={{
                              width: 26,
                              height: 26,
                              flexShrink: 0,
                              borderRadius: "var(--radius-2)",
                              background: "var(--violet-a4)",
                              color: "var(--violet-11)",
                            }}
                          >
                            <Icon size={16} />
                          </Flex>
                        }
                        onClick={() => handleStarterPrompt(prompt)}
                        className={aiChatStyles.suggestedPrompt}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </Grid>
                </Flex>
              </Flex>
            )}

          {persistedTurns.map((turn, idx) => (
            <PersistedTurn
              key={idx}
              turn={turn}
              toolDetailsOpenRef={toolDetailsOpenRef}
              feedbackMap={feedbackMap}
              onFeedbackSubmit={handleFeedbackSubmit}
              feedbackTrackingEventName="AI Assistant Feedback"
              stepsExpanded={
                idx === persistedTurns.length - 1 && stepsExpandedRef.current
              }
              onStepsToggle={
                idx === persistedTurns.length - 1
                  ? handleStepsToggle
                  : undefined
              }
              awaitingInteraction={
                interactionPending && idx === persistedTurns.length - 1
              }
            />
          ))}

          {(loading ||
            collapsedActiveSteps.length > 0 ||
            visibleItems.length > 0 ||
            activeStatus) && (
            <Flex
              ref={activeTurnRef}
              direction="column"
              gap="3"
              style={{ minHeight: activeTurnMinHeight }}
            >
              {collapsedActiveSteps.length > 0 && (
                <CollapsedSteps
                  count={collapsedActiveSteps.length}
                  items={collapsedActiveSteps}
                  defaultExpanded={stepsExpandedRef.current}
                  onToggle={handleStepsToggle}
                />
              )}

              {visibleItems.map((item) => {
                if (item === latestActivityItem) return null;
                const rendered = (
                  <ActiveTurnItemRow
                    item={item}
                    displayedTextMap={displayedTextMap}
                    toolDetailsOpenRef={toolDetailsOpenRef}
                  />
                );
                const key =
                  item.kind === "tool-status" ? item.toolCallId : item.id;
                return (
                  <div
                    key={key}
                    className={`${aiChatStyles.activeTurnItemWrapper}${
                      item.kind === "text" && fadingTextIds.has(item.id)
                        ? ` ${aiChatStyles.collapsingItem}`
                        : ""
                    }`}
                  >
                    {rendered}
                  </div>
                );
              })}

              {activeStatus && (
                <CollapsedSteps count={0} items={[]} active={activeStatus} />
              )}
            </Flex>
          )}

          {error && <ErrorBubble>{error}</ErrorBubble>}

          {askPrompt && !askPrompt.resolved && (
            <AskUserCard
              prompt={askPrompt}
              loading={loading}
              onSelect={handleAskOption}
            />
          )}

          {confirmPrompt && !confirmPrompt.resolved && (
            <ConfirmActionCard
              prompt={confirmPrompt}
              loading={loading}
              onDecide={handleConfirmAction}
            />
          )}
        </Flex>
      </Box>

      {/* Input */}
      <ChatComposer
        variant="compact"
        ref={composerRef}
        autoFocus
        mentionItems={mentionItems}
        mentionItemsReady={mentionItemsReady}
        skillItems={skillItems}
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onCancel={cancelGeneration}
        loading={loading}
        isLocalStream={isLocalStream}
        placeholder="Ask GrowthBook anything…"
      />
    </Box>
  );

  return createPortal(<RadixTheme>{panel}</RadixTheme>, portalHost);
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
  toolDetailsOpenRef,
}: {
  item: ActiveTurnItem;
  displayedTextMap: Map<string, string>;
  toolDetailsOpenRef: React.MutableRefObject<Record<string, boolean>>;
}) {
  if (item.kind === "tool-status") {
    const chartData = item.toolResultData
      ? chartDataFromRecord(item.toolResultData)
      : null;
    if (chartData && item.status === "done") {
      return (
        <ExplorationBubble
          chartData={chartData}
          compact
          showSaveAction={false}
          toolTransparency={
            <ToolUsageDetails
              embedded
              summaryLabel="Query & tool response"
              toolInput={item.toolInput}
              argsTextPreview={item.argsTextPreview}
              toolOutput={item.toolOutput}
              toolCallId={item.toolCallId}
              openStateRef={toolDetailsOpenRef}
            />
          }
        />
      );
    }
    return (
      <Flex align="center" gap="2">
        <ToolStatusIcon status={item.status} />
        <Text size="sm" color="text-low">
          {item.label || CALL_API_LABEL}
        </Text>
      </Flex>
    );
  }
  if (item.kind === "text") {
    const displayed = displayedTextMap.get(item.id) ?? item.content;
    const waitingForLink = isWaitingForMarkdownLink(
      item.content,
      displayed.length,
    );
    if (!displayed && !waitingForLink) return null;
    return (
      <AssistantBubble>
        <Markdown
          resolveInternalHref={resolveAgentPanelInternalHref}
          className={
            waitingForLink ? aiChatStyles.streamingMarkdown : undefined
          }
        >
          {displayed}
        </Markdown>
        {waitingForLink && <InlineLinkLoadingIndicator />}
      </AssistantBubble>
    );
  }
  if (item.kind === "thinking") {
    return null;
  }
  return null;
}

/**
 * Renders a single persisted turn: user bubble (if any), the collapsed
 * "Completed N steps" drawer for intermediate work, then the assistant's
 * visible reply (the last plain-text message).
 */
function PersistedTurn({
  turn,
  toolDetailsOpenRef,
  feedbackMap,
  onFeedbackSubmit,
  feedbackTrackingEventName,
  stepsExpanded,
  onStepsToggle,
  awaitingInteraction,
}: {
  turn: MessageTurn;
  toolDetailsOpenRef: React.MutableRefObject<Record<string, boolean>>;
  feedbackMap: Record<string, FeedbackState>;
  onFeedbackSubmit: (
    messageId: string,
    rating: "positive" | "negative" | null,
    comment: string,
  ) => void;
  feedbackTrackingEventName?: string;
  stepsExpanded: boolean;
  onStepsToggle?: (expanded: boolean) => void;
  awaitingInteraction: boolean;
}) {
  const { preWork, replyContent, replyMessageId, replyIsError } = classifyTurn(
    turn.rest,
    awaitingInteraction,
  );
  const steps = preWorkToSteps(preWork, turn.rest, toolDetailsOpenRef);
  const charts = preWork.flatMap((msg) => {
    if (msg.role !== "tool") return [];
    return msg.content.flatMap((part, i) => {
      const pairedCall = findToolCallPart(turn.rest, part);
      const resultData = extractExplorationResultData(
        part.toolName,
        pairedCall?.args,
        part.result,
      );
      const chartData = resultData ? chartDataFromRecord(resultData) : null;
      if (!chartData) return [];
      return [
        <ExplorationBubble
          key={`${msg.id}-chart-${i}`}
          chartData={chartData}
          animate={false}
          compact
          showSaveAction={false}
          toolTransparency={
            <ToolUsageDetails
              embedded
              summaryLabel="Query & tool response"
              toolInput={pairedCall?.args}
              toolOutput={part.result}
              toolCallId={part.toolCallId}
              openStateRef={toolDetailsOpenRef}
            />
          }
        />,
      ];
    });
  });
  const hasReply = replyContent !== null && replyContent.trim().length > 0;

  return (
    <>
      {turn.user && (
        <UserBubble>
          <Text size="sm">
            <MessageTokens
              text={getUserText(turn.user)}
              mentions={
                turn.user.role === "user" ? turn.user.mentions : undefined
              }
              skills={turn.user.role === "user" ? turn.user.skills : undefined}
            />
          </Text>
        </UserBubble>
      )}

      {steps.length > 0 && (
        <CollapsedSteps
          count={steps.length}
          items={steps}
          defaultExpanded={stepsExpanded}
          onToggle={onStepsToggle}
        />
      )}

      {charts}

      {hasReply && replyIsError && <ErrorBubble>{replyContent}</ErrorBubble>}

      {hasReply && !replyIsError && (
        <AssistantBubble>
          <Markdown resolveInternalHref={resolveAgentPanelInternalHref}>
            {replyContent}
          </Markdown>
        </AssistantBubble>
      )}

      {hasReply && !replyIsError && replyMessageId && (
        <AIChatFeedback
          messageId={replyMessageId}
          value={feedbackMap[replyMessageId] ?? { rating: null, comment: "" }}
          onSubmit={onFeedbackSubmit}
          trackingEventName={feedbackTrackingEventName}
          popoverZIndex={AGENT_PANEL_PORTAL_Z_INDEX}
        />
      )}
    </>
  );
}
