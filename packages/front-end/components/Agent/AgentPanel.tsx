import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import clsx from "clsx";
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
import { getMessageText, type AIChatMessage } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import track from "@/services/track";
import { suggestedReplyFromOptions } from "@/enterprise/components/AIChat/Composer/useAutocomplete";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
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
import { GHOST_TEXT_CLASS } from "@/enterprise/components/AIChat/Composer/extensions/ghostText";
import { useAgentInteractionPrompts } from "@/enterprise/hooks/useAgentInteractionPrompts";
import { useSidebarOpen } from "@/components/Layout/SidebarOpenProvider";
import AgentChatHistory from "./AgentChatHistory";
import {
  AGENT_DOCK_MOTION_MS,
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
import styles from "./AgentPanel.module.scss";
import GrowthBotStateNotice from "./GrowthBotStateNotice";
import { useGrowthBotState } from "./useGrowthBotState";

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
const STARTER_PROMPT_TEXTS = STARTER_PROMPTS.map((p) => p.prompt);

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

// The page makes room for it (global.scss's .main reads --agent-rail-width).
const DOCKED_WIDTH = "400px";
// Before paint in the browser, as a plain effect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
// Below 1024px there's too little room beside it, so the panel covers the
// window.
const OVERLAY_MAX_WIDTH = "(max-width: 1023px)";
const PANEL_FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

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
  // At the limit, past conversations stay readable; nothing new can be sent.
  const { state: growthBotState, resetsAt, refreshUsage } = useGrowthBotState();
  const limitReached = growthBotState === "limit";
  const { setOpen: setNavDrawerOpen } = useSidebarOpen();
  const { userId, organization } = useUser();
  // Preserves each tool-detail disclosure's open/closed state across the
  // active-turn → persisted-message remount so it doesn't snap shut mid-turn.
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});
  const stepsExpandedRef = useRef(false);
  const router = useRouter();
  const { defaultAIModel } = useAISettings();
  const { aiAutocompleteEnabled = true } = useOrgSettings();
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

  const [overlay, setOverlay] = useState(false);
  const docked = !overlay;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(OVERLAY_MAX_WIDTH);
    const update = () => setOverlay(mq.matches);
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
    // Each answer adds to the usage, and a failed send may be the limit (429).
    onMessageComplete: (info) => {
      refreshUsage();
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
      refreshUsage();
      track("AI Assistant Error", {
        errorType: info.errorType,
        httpStatus: info.httpStatus,
      });
    },
  });

  // Keep the feedback hook's ref in sync with the current conversation id.
  // The ref is only read inside event handlers, never during render.
  feedbackConversationIdRef.current = conversationId;

  // An empty draft offers the assistant's likeliest option word for word, no
  // model call: a pending askUser prompt's recommended (else first) option,
  // or the "(recommended)" item when the last message ended on a plain list.
  const suggestedReply = useMemo(() => {
    if (loading) return undefined;
    if (askPrompt && !askPrompt.resolved) {
      const pick =
        askPrompt.options.find((o) => o.recommended) ?? askPrompt.options[0];
      return pick
        ? { key: `ask-${askPrompt.seq}`, text: pick.label }
        : undefined;
    }
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || last.isError) return undefined;
    // No options: an empty text still carries the key, so the composer can
    // ask the model for a reply to this message.
    return {
      key: last.id,
      text: suggestedReplyFromOptions(getMessageText(last)) ?? "",
    };
  }, [askPrompt, messages, loading]);

  // Mounted while closed but without its DOM, so the listeners wait until
  // it's open and the container exists.
  const { scrollContainerRef, handleScroll, resumeAutoScroll } = useAutoScroll({
    messages,
    activeTurnItems,
    displayedTextMap,
    conversationId,
    enabled: open,
  });

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

  // Kept mounted while it slides out. It mounts off-screen and starts sliding
  // before the first paint: the read below makes the browser take in the
  // off-screen position first, which waiting a frame doesn't guarantee on a
  // busy page (the slide is then skipped).
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(false);
  // For the whole slide in and out, and set first, before the read below
  // applies styles, so what moves on its own timing (the side nav) picks it up.
  const dockMotion = docked && (open || rendered);
  useIsomorphicLayoutEffect(() => {
    document.documentElement.classList.toggle("agent-dock-motion", dockMotion);
  }, [dockMotion]);
  useIsomorphicLayoutEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    setShown(false);
    const timer = window.setTimeout(
      () => setRendered(false),
      AGENT_DOCK_MOTION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [open]);
  useIsomorphicLayoutEffect(() => {
    if (!open || !rendered || shown) return;
    panelRef.current?.getBoundingClientRect();
    setShown(true);
  }, [open, rendered, shown]);
  const reduceMotion =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // html.agent-dock-full styles what sits beside the panel (the header's
  // GrowthBot button fades out).
  // Set as the slide starts (shown), so everything moves together.
  const dockedShown = docked && shown;
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    if (dockedShown) {
      root.style.setProperty("--agent-rail-width", DOCKED_WIDTH);
    } else {
      root.style.removeProperty("--agent-rail-width");
    }
    root.classList.toggle("agent-dock-full", dockedShown);
    root.classList.toggle(
      "agent-dock-full-expanded",
      dockedShown && open && expanded,
    );
  }, [dockedShown, open, expanded]);
  useEffect(
    () => () => {
      const root = document.documentElement;
      root.style.removeProperty("--agent-rail-width");
      root.classList.remove(
        "agent-dock-full",
        "agent-dock-full-expanded",
        "agent-dock-motion",
      );
    },
    [],
  );

  // Where there's no message box (at the daily limit), focus goes to the
  // panel itself.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      const timer = window.setTimeout(() => {
        const panelEl = panelRef.current;
        if (panelEl && !panelEl.contains(document.activeElement)) {
          panelEl.focus({ preventScroll: true });
        }
      }, 50);
      return () => window.clearTimeout(timer);
    }
    const panelEl = panelRef.current;
    const active = document.activeElement;
    const focusWasInPanel =
      !!panelEl && (panelEl.contains(active) || active === document.body);
    const target =
      returnFocusRef.current && returnFocusRef.current.isConnected
        ? returnFocusRef.current
        : document.querySelector<HTMLElement>("[data-growthbot-trigger]");
    if (!focusWasInPanel || !target) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        target.focus({ preventScroll: true }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Not while the side nav's drawer is open over it (it keeps its own), nor
  // once focus has left the panel.
  useEffect(() => {
    if (!overlay || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      if (document.documentElement.classList.contains("app-drawer-open")) {
        return;
      }
      const panelEl = panelRef.current;
      const active = document.activeElement;
      if (!panelEl || !active || !panelEl.contains(active)) return;
      const items = Array.from(
        panelEl.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE),
      ).filter(
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden",
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (active === first || active === panelEl)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlay, open]);

  // The editor claims every Esc (ProseMirror), so whether the message box
  // owns it is decided before it sees the key.
  const inputRef = useRef(input);
  inputRef.current = input;
  const composerOwnsEscRef = useRef(false);
  const handlePanelKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      const editor = (event.target as HTMLElement).closest<HTMLElement>(
        "[contenteditable='true']",
      );
      composerOwnsEscRef.current =
        !!editor &&
        (!!inputRef.current.trim() ||
          editor.getAttribute("aria-expanded") === "true" ||
          !!editor.querySelector(`.${GHOST_TEXT_CLASS}`));
    },
    [],
  );
  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement;
      // From a portaled menu or popover (React bubbles it here): theirs.
      if (!panelRef.current?.contains(target)) return;
      const fromComposer = !!target.closest("[contenteditable='true']");
      if (fromComposer ? composerOwnsEscRef.current : event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

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

  if (!rendered) return null;

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

  const limitEmptyState =
    limitReached && messages.length === 0 && !isLoadingConversation;

  const panel = (
    <Box
      ref={panelRef}
      // Docked, part of the page's chrome, so a complementary region; as an
      // overlay, a dialog.
      role={docked ? "complementary" : "dialog"}
      aria-label="GrowthBook AI assistant"
      // Focusable, so focus can move into it where there's no message box.
      tabIndex={-1}
      onKeyDownCapture={handlePanelKeyDownCapture}
      onKeyDown={handlePanelKeyDown}
      // Hidden from screen readers while it slides out.
      aria-hidden={open ? undefined : true}
      className={clsx(
        styles.panel,
        docked ? styles.docked : styles.overlay,
        expanded && styles.expanded,
      )}
      style={{
        zIndex: AGENT_PANEL_Z_INDEX,
        transform: shown ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? undefined : "none",
        // In step with the page making room (--agent-dock-*, global.scss).
        transition: reduceMotion
          ? "none"
          : "width var(--agent-dock-duration) var(--agent-dock-easing), transform var(--agent-dock-duration) var(--agent-dock-easing)",
      }}
    >
      {/* The panel sits above the app's own layer, out of the drawer veil's reach,
        so it draws its own. */}
      <div
        className={styles.navDrawerVeil}
        aria-hidden="true"
        onClick={() => setNavDrawerOpen(false)}
      />
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
            disabled={limitReached}
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
                resetsAt={resetsAt}
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

      {/* Stop stays while an answer streams: the limit can be reached mid-answer,
        by anyone in the org. */}
      {limitEmptyState ? null : limitReached && !isLocalStream ? (
        <Box
          role="status"
          px="4"
          py="4"
          style={{
            borderTop: "1px solid var(--gray-a3)",
            background: "var(--color-panel-solid)",
          }}
        >
          <GrowthBotStateNotice state="limit" resetsAt={resetsAt} />
        </Box>
      ) : (
        <ChatComposer
          variant="compact"
          ref={composerRef}
          autoFocus
          mentionItems={mentionItems}
          mentionItemsReady={mentionItemsReady}
          skillItems={skillItems}
          autocomplete={aiAutocompleteEnabled}
          suggestedReply={suggestedReply}
          quickSuggestions={
            messages.length === 0 ? STARTER_PROMPT_TEXTS : undefined
          }
          conversationId={conversationId}
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

  // In the app's own layer (the root theme's stacking context), not portaled
  // to body: above the header, and below #portal-root, so the command
  // palette and modals open over it.
  return panel;
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
