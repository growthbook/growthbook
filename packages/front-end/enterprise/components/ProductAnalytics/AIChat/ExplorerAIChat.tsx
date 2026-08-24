import React, { useRef, useEffect, useCallback, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowLineLeft, PiArrowLineRight } from "react-icons/pi";
import type { AIChatMention } from "shared/ai-chat";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import track from "@/services/track";
import Button from "@/ui/Button";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import ConversationSidebar from "@/enterprise/components/AIChat/ConversationSidebar";
import AIChatGatingScreen from "@/enterprise/components/AIChat/AIChatGatingScreen";
import ChatComposer, {
  type ChatComposerHandle,
} from "@/enterprise/components/AIChat/Composer/ChatComposer";
import {
  PRODUCT_ANALYTICS_CHAT_SKILL_GROUP,
  useSkillMenuItems,
} from "@/enterprise/components/AIChat/Composer/useSkillCommandItems";
import { useAgentInteractionPrompts } from "@/enterprise/hooks/useAgentInteractionPrompts";
import AskUserCard, {
  type AskUserOption,
} from "@/components/Agent/AskUserCard";
import ConfirmActionCard from "@/components/Agent/ConfirmActionCard";
import { useMentionItems } from "@/enterprise/components/AIChat/Composer/useMentionItems";
import { useChatFeedback } from "@/enterprise/components/AIChat/useChatFeedback";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import {
  takeInitialChatMessage,
  type PAInitialChatMessage,
} from "@/enterprise/components/ProductAnalytics/util";
import ChatMessageList, { TOOL_STATUS_LABELS } from "./ChatMessageList";
import { useConversationList } from "./useConversationList";
import { useChatModel } from "./useChatModel";
import { useAutoScroll } from "./useAutoScroll";

export default function ExplorerAIChat() {
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});
  const prevLoadingRef = useRef(false);
  const composerRef = useRef<ChatComposerHandle>(null);

  const initialMessageRef = useRef<PAInitialChatMessage | null>(
    takeInitialChatMessage(),
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled, defaultAIModel } = useAISettings();
  const permissionsUtil = usePermissionsUtil();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const { draftExploreState } = useExplorerContext();
  const { items: mentionItems, ready: mentionItemsReady } = useMentionItems(
    draftExploreState.datasource,
  );
  // Scoped to the dashboard domain to match what this chat's agent can load —
  // see PRODUCT_ANALYTICS_CHAT_SKILL_GROUP on the back end.
  const skillItems = useSkillMenuItems(PRODUCT_ANALYTICS_CHAT_SKILL_GROUP);
  // The dashboard skills use `askUser` and write through the confirmation gate,
  // so this chat has to render both prompts — an unhandled `confirm-action`
  // would park a dashboard create the user can never approve.
  const {
    askPrompt,
    confirmPrompt,
    handleSSEEvent: handleInteractionEvent,
    syncFromConversation,
    takePendingDecision,
    resolveOnUserMessage,
    resolveAsk,
    resolveConfirm,
    reset: resetPrompts,
  } = useAgentInteractionPrompts();

  // -- Hooks with no cross-dependencies (safe to call first) -----------------

  const { chatModel, setChatModel } = useChatModel(defaultAIModel);

  const {
    feedbackMap,
    handleFeedbackSubmit,
    loadFeedbackFromConversation,
    clearFeedback,
    conversationIdRef: feedbackConversationIdRef,
  } = useChatFeedback();

  // One-shot handoff: `buildRequestBody` is a stable callback, so the current
  // send's mentions and skills are stashed here rather than closed over.
  const pendingMentionsRef = useRef<AIChatMention[]>([]);
  const pendingSkillsRef = useRef<string[]>([]);

  const buildRequestBody = useCallback(
    (message: string, cid: string) => {
      const mentions = pendingMentionsRef.current;
      const skills = pendingSkillsRef.current;
      pendingMentionsRef.current = [];
      pendingSkillsRef.current = [];
      const decision = takePendingDecision();
      return {
        message,
        conversationId: cid,
        datasourceId: draftExploreState.datasource,
        model: chatModel,
        ...(mentions.length ? { mentions } : {}),
        ...(skills.length ? { skills } : {}),
        ...(decision ?? {}),
      };
    },
    [draftExploreState.datasource, chatModel, takePendingDecision],
  );

  // -- Core chat hook --------------------------------------------------------

  const {
    messages,
    rehydratedMessageIds,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    cancelGeneration,
    newChat,
    loadConversation,
    loading,
    isLoadingConversation,
    isLocalStream,
    waitingForNextStep,
    isRemoteStream,
    error,
    input,
    setInput,
    conversationId,
  } = useAIChat({
    endpoint: "/product-analytics/chat",
    buildRequestBody,
    toolStatusLabels: TOOL_STATUS_LABELS,
    getConversationEndpoint: (cid) => `/product-analytics/chat/${cid}`,
    getCancelEndpoint: (cid) => `/product-analytics/chat/${cid}/cancel`,
    onStreamAccepted: () => {
      void refreshList();
    },
    onSSEEvent: (event) => {
      if (event.type === "conversation-title") {
        const title = (event.data.title as string) || "";
        if (title) handleTitleUpdate(conversationId, title);
      }
      handleInteractionEvent(event);
    },
    onConversationLoaded: (data) => {
      syncFromConversation(data);
      loadFeedbackFromConversation(data);
    },
    onMessageComplete: (info) => {
      track("AI Chat Response Completed", {
        model: chatModel,
        durationMs: info.durationMs,
        toolCallCount: info.toolCallCount,
      });
    },
    onMessageCancelled: (info) => {
      track("AI Chat Generation Cancelled", {
        model: chatModel,
        durationMs: info.durationMs,
      });
    },
    onMessageError: (info) => {
      track("AI Chat Error", {
        errorType: info.errorType,
        httpStatus: info.httpStatus,
      });
    },
  });

  // Keep the feedback hook's ref in sync with the current conversation id.
  // The ref is only read inside event handlers, never during render.
  feedbackConversationIdRef.current = conversationId;

  // -- Hooks that depend on useAIChat return values --------------------------

  const {
    conversations,
    rawConversations,
    refreshList,
    handleTitleUpdate,
    deleteConversation,
  } = useConversationList(conversationId, messages, loading);

  const { scrollContainerRef, messagesEndRef, handleScroll } = useAutoScroll(
    messages,
    activeTurnItems,
    conversationId,
  );

  // -- Handlers --------------------------------------------------------------

  const trackAndSend = useCallback(
    (
      messageOverride?: string,
      mentions: AIChatMention[] = [],
      skills: string[] = [],
    ) => {
      const text = (messageOverride ?? input).trim();
      if (!text) return;
      pendingMentionsRef.current = mentions;
      pendingSkillsRef.current = skills;
      resolveOnUserMessage();
      track("AI Chat Message Sent", {
        model: chatModel,
        messageCount: messages.length,
        isFirstMessage: messages.length === 0,
        skills,
      });
      sendMessage(messageOverride, { mentions, skills });
    },
    [input, chatModel, messages.length, sendMessage, resolveOnUserMessage],
  );

  // -- Effects ---------------------------------------------------------------

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
      composerRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  useEffect(() => {
    track("AI Chat Page Viewed", {
      hasInitialMessage: initialMessageRef.current !== null,
    });
  }, []);

  // Refocus when switching conversations. The mount case is the composer's
  // own `autoFocus`, since the editor doesn't exist yet on the first commit.
  useEffect(() => {
    composerRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    const initial = initialMessageRef.current;
    if (!initial) return;
    initialMessageRef.current = null;
    trackAndSend(initial.text, initial.mentions, initial.skills);
  }, [trackAndSend]);

  const handleAskOption = useCallback(
    (option: AskUserOption) => {
      if (loading || !resolveAsk(option)) return;
      sendMessage(option.label);
    },
    [resolveAsk, sendMessage, loading],
  );

  const handleConfirmAction = useCallback(
    (decision: "confirm" | "cancel") => {
      if (loading || !resolveConfirm(decision)) return;
      // The decision is a control signal — don't render it as a user bubble.
      sendMessage(decision === "confirm" ? "Confirm" : "Cancel", {
        suppressUserMessage: true,
      });
    },
    [resolveConfirm, sendMessage, loading],
  );

  const handleNewChat = useCallback(() => {
    track("AI Chat New Conversation", {
      previousConversationMessageCount: messages.length,
    });
    newChat();
    setChatModel(defaultAIModel);
    clearFeedback();
    resetPrompts();
    refreshList();
  }, [
    newChat,
    refreshList,
    defaultAIModel,
    setChatModel,
    clearFeedback,
    resetPrompts,
    messages.length,
  ]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        track("AI Chat Delete Conversation");
        await deleteConversation(id);
        if (id === conversationId) newChat();
      } catch {
        // silently ignore
      }
    },
    [deleteConversation, conversationId, newChat],
  );

  // -- Render ----------------------------------------------------------------

  if (!hasAISuggestions || !aiEnabled) {
    return (
      <AIChatGatingScreen
        hasAISuggestions={hasAISuggestions}
        canManageOrgSettings={permissionsUtil.canManageOrgSettings()}
      />
    );
  }

  return (
    <Flex
      direction="row"
      style={{
        height: "calc(100vh - 56px)",
        minHeight: 0,
        background: "var(--color-background)",
        border: "1px solid var(--gray-a6)",
        minWidth: 0,
      }}
    >
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelect={(id) => {
          track("AI Chat Load Conversation");
          void loadConversation(id);
          const conv = rawConversations?.find((c) => c.conversationId === id);
          setChatModel(conv?.model ?? defaultAIModel);
        }}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
        collapsed={!sidebarOpen}
      />

      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        <Flex
          align="center"
          justify="between"
          px="4"
          py="3"
          flexShrink="0"
          style={{
            borderBottom: "1px solid var(--gray-a3)",
            background: "var(--color-panel-solid)",
          }}
        >
          <Flex align="center" gap="2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen((o) => !o)}
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? (
                <PiArrowLineLeft size={16} />
              ) : (
                <PiArrowLineRight size={16} />
              )}
            </Button>
            <DataSourceDropdown />
          </Flex>
        </Flex>

        <ChatMessageList
          messages={messages}
          rehydratedMessageIds={rehydratedMessageIds}
          activeTurnItems={activeTurnItems}
          displayedTextMap={displayedTextMap}
          loading={loading}
          isLoadingConversation={isLoadingConversation}
          isRemoteStream={isRemoteStream}
          waitingForNextStep={waitingForNextStep}
          error={error}
          feedbackMap={feedbackMap}
          onFeedbackSubmit={handleFeedbackSubmit}
          toolDetailsOpenRef={toolDetailsOpenRef}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
          footer={
            <>
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
            </>
          }
        />

        <ChatComposer
          ref={composerRef}
          autoFocus
          mentionItems={mentionItems}
          mentionItemsReady={mentionItemsReady}
          value={input}
          onChange={setInput}
          skillItems={skillItems}
          onSend={({ text, mentions, skills }) =>
            trackAndSend(text, mentions, skills)
          }
          onCancel={cancelGeneration}
          loading={loading}
          isLocalStream={isLocalStream}
        />
      </Flex>
    </Flex>
  );
}
