import clsx from "clsx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/router";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiCornersInBold,
  PiCornersOutBold,
  PiChartLine,
  PiChartLineUp,
  PiFlag,
  PiFlask,
  PiPlus,
  PiSparkle,
  PiX,
  PiXBold,
} from "react-icons/pi";
import { useSWRConfig } from "swr";
import type { AIChatMessage } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";
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
import { usePrototypeDockedGrowthBot } from "@/components/Layout/PrototypeControls";
import Tooltip from "@/ui/Tooltip";
import AgentChatHistory from "./AgentChatHistory";
import {
  AGENT_PANEL_PORTAL_Z_INDEX,
  AGENT_PANEL_Z_INDEX,
} from "./AgentPanelContext";
import {
  type MessageTurn,
  groupMessagesByTurn,
  classifyTurn,
  interactionContextTextId,
  assistantText,
  getUserText,
} from "./agentMessageUtils";
import AskUserCard, { type AskUserOption } from "./AskUserCard";
import ConfirmActionCard from "./ConfirmActionCard";
import { dashboardWriteFromEvent } from "./dashboardWrite";
import { resolveAgentInternalHref } from "./agentLinkUtils";
import GrowthBotStateNotice from "./GrowthBotStateNotice";
import styles from "./AgentPanel.module.scss";
import { useGrowthBotPrototype } from "./prototypeGrowthBotState";

// Scoped per org and user below: conversation ids are unique across the whole
// collection but only readable by their owner, so a stale id from another org
// or account would make the next send collide on insert.
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

// The first two shortened (set in review; were "Help me understand and
// analyze my product metrics" and "Show me how my recently started
// experiments are going"), so each fits on one line in the docked rail,
// all four starting "Help me".
const STARTER_PROMPTS = [
  {
    prompt: "Help me analyze my product metrics",
    Icon: PiChartLine,
  },
  {
    prompt: "Help me check on my recent experiments",
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
// The slide in and out's length (set in review), as the side nav's.
const PANEL_SLIDE_MS = 200;
// PROTOTYPE ("Docked GrowthBot", set in review): the docked rail's width,
// the page's head start when it opens, and the header's height, which it
// sits below.
// 400px (set in review; tried 424px and 416px).
const DOCKED_WIDTH = "400px";
const HEADER_HEIGHT = "44px";
// 80ms (set in review; was 50ms, and the page sometimes still fell
// behind), with the page's push quicker and front-loaded (global.scss).
const DOCKED_OPEN_DELAY_MS = 80;

export default function AgentPanel({
  open,
  expanded = false,
  onClose,
  onToggleExpanded,
}: AgentPanelProps) {
  const composerRef = useRef<ChatComposerHandle>(null);
  const { userId, organization } = useUser();
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
    conversationStorageKey: `${STORAGE_KEY}:${organization.id}:${userId}`,
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

  // PROTOTYPE ("Docked GrowthBot", set in review): whether there's more of
  // the conversation above or below what's shown, for the fades at its
  // edges (AgentPanel.module.scss). Checked on scroll, on resize, and as
  // replies stream in.
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const checkFades = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setFadeTop(el.scrollTop > 1);
    setFadeBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, [scrollContainerRef]);

  const { ref: activeTurnRef, minHeight: activeTurnMinHeight } =
    useRatchetedMinHeight(loading);

  const contextTextId = interactionContextTextId(
    activeTurnItems,
    (askPrompt !== null && !askPrompt.resolved) ||
      (confirmPrompt !== null && !confirmPrompt.resolved),
  );
  const { collapsedItems, visibleItems, fadingTextIds } =
    useCollapsibleActiveTurnItems(activeTurnItems, displayedTextMap, {
      fadeSupersededText: true,
      isPinned: (item) =>
        item.id === contextTextId ||
        (item.kind === "tool-status" &&
          item.status === "done" &&
          !!item.toolResultData &&
          chartDataFromRecord(item.toolResultData) !== null),
    });

  // PROTOTYPE ONLY (set in review): the "Limit reached" state
  // (prototypeGrowthBotState.ts). Nothing new can be sent or started; the
  // limit notice shows as the empty state, or, in a past chat (still
  // readable), in place of the message box.
  const { state: growthBotState, canUpgrade: growthBotCanUpgrade } =
    useGrowthBotPrototype();
  const limitReached = growthBotState === "limit";

  // Slides in from the right on open and back out on close (set in review),
  // over 200ms with an ease, as the side nav's collapse and expand. Kept
  // mounted (and not clickable) while it slides out; it starts off-screen
  // and moves in a frame later, so the slide in plays. Instant for reduced
  // motion.
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setRendered(true);
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShown(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setRendered(false), PANEL_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // PROTOTYPE ("Docked GrowthBot" in the prototype panel; set in review):
  // part of the page's chrome rather than over the page. A right rail
  // below the header (set in review; tried full height, beside the
  // header), and the page makes room for it (--agent-rail-width,
  // global.scss's .main), so its 32px right padding is the gap between
  // them; the header stays full width. The page moves over as the rail slides in, in
  // step (set in review; the page was instant). Expanded, it's a
  // focus mode, filling the page area beside the side nav, below the
  // header.
  // Not modal, so a complementary region, not a dialog. Where the side
  // nav is off-canvas (1180px and under), it floats as before.
  const dockSetting = usePrototypeDockedGrowthBot();
  const docked = dockSetting && !sidebarCollapsed;
  // Full height (set in review; tried starting below the header, then as a
  // setting): the rail runs from the window's top, square, without its top
  // outline, over the header's right end. Its top row sits in the header's
  // band; the header's GrowthBot button fades out while it's open
  // (GrowthBotButton.module.scss; html.agent-dock-full), the rail's X in
  // its corner. Expanded, it covers the header beside the side nav.
  const fullHeight = docked;
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!docked || !rendered || !el) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(checkFades);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const mutations = new MutationObserver(schedule);
    mutations.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [docked, rendered, checkFades, scrollContainerRef]);
  useEffect(() => {
    const root = document.documentElement;
    if (docked && open)
      root.style.setProperty("--agent-rail-width", DOCKED_WIDTH);
    else root.style.removeProperty("--agent-rail-width");
    root.classList.toggle("agent-dock-full", fullHeight && open);
    root.classList.toggle(
      "agent-dock-full-expanded",
      fullHeight && open && expanded,
    );
  }, [docked, open, fullHeight, expanded]);
  useEffect(
    () => () => {
      const root = document.documentElement;
      root.style.removeProperty("--agent-rail-width");
      root.classList.remove("agent-dock-full", "agent-dock-full-expanded");
    },
    [],
  );

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
      if (!text || loading || limitReached) return;
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
      limitReached,
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

  if (!rendered || !portalHost) return null;

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
  // A confirm/cancel decision resumes the last turn without a user bubble, so
  // its live steps belong in that turn's drawer rather than a second one.
  const continuesLastTurn =
    (loading || activeTurnItems.length > 0) &&
    messages.length > 0 &&
    messages[messages.length - 1].role !== "user";
  const confirmationPending =
    confirmPrompt !== null && (!confirmPrompt.resolved || loading);
  const interactionPending =
    (askPrompt !== null && !askPrompt.resolved) || confirmationPending;

  // At the limit with no conversation open: the notice is the body's empty
  // state, and there's no footer. A past conversation keeps its messages,
  // with the notice in the footer.
  const limitEmptyState =
    limitReached && messages.length === 0 && !isLoadingConversation;

  const panel = (
    <Box
      role={docked ? "complementary" : "dialog"}
      aria-label="GrowthBook AI assistant"
      // Hidden from screen readers while it slides out (set in review).
      aria-hidden={open ? undefined : true}
      style={{
        position: "fixed",
        right: 0,
        top: docked && !fullHeight ? HEADER_HEIGHT : 0,
        bottom: 0,
        // Right-anchored, overlapping the navbar. Expanded grows to ~90% of the
        // main content region (100vw minus the 240px sidebar, or full width when
        // the sidebar is collapsed) so a sliver of the page stays visible
        // behind it; collapsed is a lightweight right-edge overlay. Width
        // animates between the two states.
        left: "auto",
        width: docked
          ? expanded
            ? // The page area: 100% is the viewport without its scrollbar,
              // so it meets the side nav exactly.
              "calc(100% - var(--app-rail-width, 240px))"
            : DOCKED_WIDTH
          : expanded
            ? `calc((100vw - ${sidebarCollapsed ? "0px" : "var(--app-rail-width, 240px)"}) * 0.9)`
            : "min(400px, 100vw)",
        // The page's background, or, on the redesigned pages, the side nav's
        // grey (--agent-panel-background, set by those pages; set in review).
        background: "var(--agent-panel-background, var(--color-background))",
        // Docked in focus mode, no line on the left (set in review): it
        // meets the side nav, whose own border is that edge.
        borderLeft: docked && expanded ? "none" : "1px solid var(--gray-a3)",
        // Docked (set in review): a panel set into the page, its top edge
        // defined, as the header has no line under it: the outline along
        // the top too, and a 12px top-left corner, its contents clipped to
        // it.
        ...(docked
          ? {
              // Full height, no top line and square: it meets the window's
              // top, as the side nav does.
              borderTop: fullHeight ? "none" : "1px solid var(--gray-a3)",
              // Square in focus mode (set in review), where it fills the
              // page area beside the side nav.
              borderTopLeftRadius: expanded || fullHeight ? 0 : 12,
              overflow: "hidden",
            }
          : {}),
        // The side nav menus' soft layered shadow (ExperimentsListTable
        // .module.scss's .menuShadow), turned to fall left, off the drawer's
        // edge (set in review; was -8px 0 24px --black-a4), in a softer
        // slate grey than the menus' black, and blurred a little more (set
        // in review; the outer layer was 8px).
        // Docked, no shadow: it's beside the page, not over it.
        boxShadow: docked
          ? "none"
          : "0 0 3px var(--slate-a3), -1px 0 2px var(--slate-a3), -4px 0 12px -2px var(--slate-a4)",
        display: "flex",
        flexDirection: "column",
        zIndex: AGENT_PANEL_Z_INDEX,
        transform: shown ? "translateX(0)" : "translateX(100%)",
        // Its own layer, so the slide runs off the main thread (set in
        // review): docked, the page re-lays itself out on every frame as it
        // makes room, and with the slide on the same thread it sometimes
        // skipped frames and seemed to jump in.
        willChange: "transform",
        pointerEvents: open ? undefined : "none",
        // Docked, opening: the slide starts 50ms after the page starts
        // making room (set in review), so the page, re-laid out as it goes
        // and sometimes a frame or two behind, stays ahead of the rail
        // rather than being briefly covered. Closing, no wait.
        transition: reduceMotion
          ? "none"
          : `width 220ms cubic-bezier(0.4, 0, 0.2, 1), transform ${PANEL_SLIDE_MS}ms ease ${
              docked && shown ? DOCKED_OPEN_DELAY_MS : 0
            }ms`,
      }}
    >
      {/* Header */}
      {/* Docked (set in review): no sparkle or "AI Assistant" title (it
        stays for screen readers). On the left, one control for
        conversations, the current one's title opening the recent ones and
        New conversation (was a clock icon and a "+"); on the right, expand
        and close. */}
      <Flex
        align="center"
        justify="between"
        // Docked, 24px either side, as the rest of the rail (set in review;
        // was 16px; the right was 32px, to line up with the header's
        // GrowthBot button).
        px={docked ? "5" : "4"}
        // Docked, 20px above (set in review; was 12px, tried 24px, the page
        // frame's top), so this row lines up with the page's title row
        // beside it. 20px isn't on Radix's scale, so it's in style.
        pt={docked ? undefined : "3"}
        pb={docked ? undefined : "3"}
        style={{
          // Docked, in the header's 44px band at the top of the rail (set
          // in review; was a row below it, under the header's GrowthBot
          // button, which hides while the rail's open), 2px below its
          // centre (set in review), in line with the header's breadcrumb.
          minHeight: docked ? 44 : undefined,
          paddingTop: docked ? 8 : undefined,
          paddingBottom: docked ? 4 : undefined,
          // Docked, no line under it (set in review): one continuous panel.
          borderBottom: docked ? "none" : "1px solid var(--gray-a3)",
          // Docked, on the rail's own colour (set in review), so it's one
          // panel, not a white strip on a grey one.
          background: docked ? "transparent" : "var(--color-panel-solid)",
        }}
      >
        {docked ? (
          <Flex align="center" minWidth="0">
            <h2 className="sr-only">AI Assistant</h2>
            <AgentChatHistory
              activeConversationId={conversationId}
              onSelect={handleSelectConversation}
              onNewChat={handleNewChat}
              // At the limit (prototype), no new conversations.
              newChatDisabled={limitReached}
            />
          </Flex>
        ) : (
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
        )}
        <Flex align="center" gap="3" flexShrink="0">
          {docked ? null : (
            <>
              <AgentChatHistory
                activeConversationId={conversationId}
                onSelect={handleSelectConversation}
              />
              <IconButton
                variant="ghost"
                size="1"
                onClick={handleNewChat}
                // At the limit (prototype), no new conversations (set in
                // review).
                disabled={limitReached}
                title="Start new conversation"
                aria-label="Start new conversation"
              >
                <PiPlus size={18} />
              </IconButton>
            </>
          )}
          {onToggleExpanded && (
            <Tooltip
              // Docked, the design system's tooltip on hover and focus (set
              // in review; was the browser's), over the rail.
              enabled={docked}
              content={expanded ? "Collapse" : "Expand"}
              side="bottom"
              style={{ zIndex: AGENT_PANEL_PORTAL_Z_INDEX }}
            >
              <IconButton
                variant="ghost"
                // Docked, as the conversation button (set in review): grey,
                // medium (32px), its icon bold, 16px, in --slate-12.
                color={docked ? "gray" : undefined}
                size={docked ? "2" : "1"}
                style={docked ? { color: "var(--slate-12)" } : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onToggleExpanded}
                title={
                  docked
                    ? undefined
                    : expanded
                      ? "Minimize panel"
                      : "Maximize panel"
                }
                aria-label={
                  expanded ? "Minimize agent panel" : "Maximize agent panel"
                }
              >
                {/* Docked, corners in and out (set in review; were arrows). */}
                {docked ? (
                  expanded ? (
                    <PiCornersInBold size={16} />
                  ) : (
                    <PiCornersOutBold size={16} />
                  )
                ) : expanded ? (
                  <PiArrowsInSimple size={18} />
                ) : (
                  <PiArrowsOutSimple size={18} />
                )}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip
            enabled={docked}
            content="Close"
            side="bottom"
            style={{ zIndex: AGENT_PANEL_PORTAL_Z_INDEX }}
          >
            <IconButton
              variant="ghost"
              // Docked, as the conversation button (set in review).
              color={docked ? "gray" : undefined}
              size={docked ? "2" : "1"}
              style={docked ? { color: "var(--slate-12)" } : undefined}
              onClick={onClose}
              title={docked ? undefined : "Close"}
              aria-label="Close agent panel"
            >
              {/* Docked, an X, bold, as the other icons here (set in review;
              tried the side nav's collapse icon, mirrored). */}
              {docked ? <PiXBold size={16} /> : <PiX size={18} />}
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>

      {/* Messages */}
      <Box
        ref={scrollContainerRef}
        onScroll={() => {
          handleScroll();
          if (docked) checkFades();
        }}
        className={
          docked
            ? clsx(
                styles.dockedMessages,
                fadeTop && styles.fadeTop,
                fadeBottom && styles.fadeBottom,
              )
            : undefined
        }
        // Docked, 24px either side (set in review; was 20px; tried 32px
        // either side, which made the gap from the page's content look too
        // wide, then 24px left and 32px right, which looked uneven).
        style={{
          flex: 1,
          overflowY: "auto",
          // Docked, 20px on top (set in review; tried 16px).
          padding: docked ? "20px 24px" : "20px",
        }}
      >
        {/* At the limit (prototype) with no conversation open: the limit
          notice alone, as the body's empty state, centred, in place of the
          greeting and suggestions (set in review). */}
        {limitEmptyState ? (
          <Flex
            align="center"
            justify="center"
            style={{ height: "100%" }}
            role="status"
          >
            <Box style={{ width: "min(320px, 100%)" }}>
              <GrowthBotStateNotice
                state="limit"
                canUpgrade={growthBotCanUpgrade}
                centered
              />
            </Box>
          </Flex>
        ) : null}
        <Flex direction="column" gap="3">
          {messages.length === 0 &&
            !limitReached &&
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
                className={docked ? styles.dockedIntro : undefined}
              >
                {/* Docked, the greeting sits on the rail, without its box
                  (set in review), so its text starts at the rail's 32px
                  edge, as everything else in it. */}
                <Box
                  p={docked ? "0" : "4"}
                  style={
                    docked
                      ? undefined
                      : {
                          border: "1px solid var(--violet-a3)",
                          borderRadius: "var(--radius-3)",
                          background: "var(--gray-a2)",
                        }
                  }
                >
                  <Flex direction="column" gap="3">
                    <Text size="md" weight="semibold">
                      {/* Docked, by name (set in review), as the header's
                        button: GrowthBot, GrowthBook's AI assistant. */}
                      {docked ? "Hi, I’m GrowthBot 👋" : "Hey there! 👋"}
                    </Text>
                    <Text size="md" color="text-mid">
                      {/* Docked, in slate (set in review): .dockedIntro. */}
                      {docked
                        ? "I’m your GrowthBook AI assistant. "
                        : "I’m your AI Assistant. "}
                      I have access to your experiments, Feature Flags, metrics,
                      and database schemas.
                      {/* Docked, the invitation as its own paragraph, 8px
                        below (set in review; tried a plain line break). */}
                      {docked ? (
                        <span
                          style={{
                            display: "block",
                            marginTop: "var(--space-2)",
                          }}
                        >
                          Let me know what you&apos;d like to build or explore
                          today!
                        </span>
                      ) : (
                        <>
                          {" "}
                          Let me know what you&apos;d like to build or explore
                          today!
                        </>
                      )}
                    </Text>
                  </Flex>
                </Box>
                <Flex direction="column" gap="2">
                  {docked ? (
                    // Docked, as the greeting above (set in review): 14px,
                    // semibold, its colour; still a heading.
                    <h3 className={styles.introHeading}>
                      <Text size="md" weight="semibold">
                        Suggestions
                      </Text>
                    </h3>
                  ) : (
                    <Heading as="h3" size="xs" color="text-low">
                      Suggestions
                    </Heading>
                  )}
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
              docked={docked}
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
              liveSteps={
                continuesLastTurn && idx === persistedTurns.length - 1
                  ? collapsedActiveSteps
                  : undefined
              }
            />
          ))}

          {(loading ||
            (!continuesLastTurn && collapsedActiveSteps.length > 0) ||
            visibleItems.length > 0 ||
            activeStatus) && (
            <Flex
              ref={activeTurnRef}
              direction="column"
              gap="3"
              style={{ minHeight: activeTurnMinHeight }}
            >
              {!continuesLastTurn && collapsedActiveSteps.length > 0 && (
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
                      item.kind === "text" &&
                      fadingTextIds.has(item.id) &&
                      item.id !== contextTextId
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

      {/* Input; at the limit (prototype) in a past conversation, the limit
        notice in its place, on the header's panel colour with the same top
        border. */}
      {limitEmptyState ? null : limitReached ? (
        <Box
          role="status"
          // Docked, 24px either side, as the rail's other rows (set in
          // review).
          px={docked ? "5" : "4"}
          py="4"
          // Docked, on the rail's colour with no line above (set in
          // review), as the message box.
          style={
            docked
              ? undefined
              : {
                  borderTop: "1px solid var(--gray-a3)",
                  background: "var(--color-panel-solid)",
                }
          }
        >
          <GrowthBotStateNotice
            state="limit"
            canUpgrade={growthBotCanUpgrade}
          />
        </Box>
      ) : (
        <ChatComposer
          variant="compact"
          // Docked, the footer on the rail's colour, no line above it (set
          // in review).
          seamless={docked}
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
      )}
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
 * visible reply (the last plain-text message). `liveSteps` are the active
 * turn's collapsed steps when it is resuming this turn; they join its drawer.
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
  liveSteps,
  docked = false,
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
  liveSteps?: CollapsedStepItem[];
  // PROTOTYPE ("Docked GrowthBot", set in review): the user's messages at
  // the replies' size.
  docked?: boolean;
}) {
  const {
    preWork,
    replyContent,
    replyMessageId,
    replyIsError,
    replyAwaitsUser,
  } = classifyTurn(turn.rest, {
    awaitingInteraction,
    continuing: liveSteps !== undefined,
  });
  const steps = [
    ...preWorkToSteps(preWork, turn.rest, toolDetailsOpenRef),
    ...(liveSteps ?? []),
  ];
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
        <UserBubble
          // Docked, soft with speech-bubble corners (set in review; was
          // solid violet, which read as a button).
          soft={docked}
        >
          {/* Docked, at the replies' size (set in review; was a size
            smaller). */}
          <Text size={docked ? "md" : "sm"}>
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

      {hasReply && !replyIsError && !replyAwaitsUser && replyMessageId && (
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
