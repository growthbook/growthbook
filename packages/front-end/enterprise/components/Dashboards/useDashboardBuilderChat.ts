import { useCallback, useEffect, useRef, useState } from "react";
import type { AIChatMention } from "shared/ai-chat";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import { useAgentInteractionPrompts } from "@/enterprise/hooks/useAgentInteractionPrompts";
import { useAutoScroll } from "@/enterprise/components/AIChat/useAutoScroll";
import { LOCALSTORAGE_EXPLORER_DATASOURCE_KEY } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import type { BuilderMode } from "./DashboardBuilderRail";
import { takeDashboardBuilderHandoff } from "./dashboardBuilderHandoff";

// The dashboard's one AI conversation: everything the rail needs, plus what the page reads.
export function useDashboardBuilderChat(
  dashboardId: string,
  onDraftChange: () => void,
) {
  const changed = useRef(onDraftChange);
  changed.current = onDraftChange;
  const { defaultAIModel } = useAISettings();
  const { getDatasourceById } = useDefinitions();
  const handoffRef = useRef(takeDashboardBuilderHandoff(dashboardId));
  const [mode, setMode] = useState<BuilderMode>(
    handoffRef.current?.mode ?? "build",
  );
  const [explorerDatasourceId] = useLocalStorage<string>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    "",
  );
  // Kept per dashboard so a reload keeps building from the same Data Source.
  const [datasourceId, setDatasourceId] = useLocalStorage<string>(
    `dashboard-builder-datasource:${dashboardId}`,
    handoffRef.current?.datasourceId || explorerDatasourceId,
  );
  useEffect(() => {
    const picked = handoffRef.current?.datasourceId;
    if (picked) setDatasourceId(picked);
  }, [setDatasourceId]);
  const datasourceName = getDatasourceById(datasourceId)?.name ?? "";

  // A call the agent parked for approval, such as a query over the cost limit.
  const {
    confirmPrompt,
    handleSSEEvent,
    syncFromConversation,
    takePendingDecision,
    resolveOnUserMessage,
    resolveConfirm,
  } = useAgentInteractionPrompts();

  const pendingMentionsRef = useRef<AIChatMention[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const buildRequestBody = useCallback(
    (message: string, conversationId: string) => {
      const mentions = pendingMentionsRef.current;
      pendingMentionsRef.current = [];
      return {
        message,
        conversationId,
        dashboardId: dashboardId,
        datasourceId,
        mode: modeRef.current,
        model: defaultAIModel,
        ...(mentions.length ? { mentions } : {}),
        ...(takePendingDecision() ?? {}),
      };
    },
    [dashboardId, datasourceId, defaultAIModel, takePendingDecision],
  );

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    cancelGeneration,
    loading,
    isLocalStream,
    error,
    input,
    setInput,
    conversationId,
  } = useAIChat({
    endpoint: "/dashboards/chat",
    buildRequestBody,
    conversationStorageKey: `dashboard-builder-chat:${dashboardId}`,
    getConversationEndpoint: (cid) => `/dashboards/chat/${cid}`,
    getCancelEndpoint: (cid) => `/dashboards/chat/${cid}/cancel`,
    onSSEEvent: (event) => {
      handleSSEEvent(event);
      // Any finished call may have changed the draft; refetching is cheap.
      if (event.type === "tool-call-end") changed.current();
    },
    // A parked call survives a reload.
    onConversationLoaded: syncFromConversation,
  });

  const { scrollContainerRef, messagesEndRef, handleScroll, resumeAutoScroll } =
    useAutoScroll({
      messages,
      activeTurnItems,
      displayedTextMap,
      conversationId,
    });

  const send = useCallback(
    (text: string, mentions: AIChatMention[] = []) => {
      if (!text.trim()) return;
      // Typing instead of answering the card drops the parked call.
      resolveOnUserMessage();
      pendingMentionsRef.current = mentions;
      resumeAutoScroll();
      sendMessage(text, { mentions });
    },
    [resolveOnUserMessage, resumeAutoScroll, sendMessage],
  );

  const decide = useCallback(
    (decision: "confirm" | "cancel") => {
      if (loading || !resolveConfirm(decision)) return;
      resumeAutoScroll();
      // A control signal for the server, not something the user said.
      sendMessage(decision === "confirm" ? "Confirm" : "Cancel", {
        suppressUserMessage: true,
      });
    },
    [loading, resolveConfirm, resumeAutoScroll, sendMessage],
  );

  useEffect(() => {
    const handoff = handoffRef.current;
    if (!handoff) return;
    handoffRef.current = null;
    send(handoff.text, handoff.mentions);
  }, [send]);

  // A build that finished while this tab was polling still needs its last blocks.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loading) changed.current();
    wasLoading.current = loading;
  }, [loading]);

  return {
    mode,
    datasourceName,
    send,
    loading,
    activeTurnItems,
    // Spread onto DashboardBuilderRail, which also needs a title and onClose.
    rail: {
      datasourceName,
      messages,
      activeTurnItems,
      displayedTextMap,
      loading,
      isLocalStream,
      error,
      mode,
      setMode,
      input,
      setInput,
      onSend: send,
      confirmPrompt,
      onDecide: decide,
      onCancel: cancelGeneration,
      scrollContainerRef,
      messagesEndRef,
      onScroll: handleScroll,
    },
  };
}
