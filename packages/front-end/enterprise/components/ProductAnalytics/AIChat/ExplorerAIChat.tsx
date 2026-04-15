import React, { useRef, useEffect, useCallback, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowLineLeft, PiArrowLineRight } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import track from "@/services/track";
import Button from "@/ui/Button";
import { useAIChat } from "@/enterprise/hooks/useAIChat";
import ConversationSidebar from "@/enterprise/components/AIChat/ConversationSidebar";
import AIChatGatingScreen from "@/enterprise/components/AIChat/AIChatGatingScreen";
import ChatInputBar from "@/enterprise/components/AIChat/ChatInputBar";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DataSourceDropdown from "@/enterprise/components/ProductAnalytics/MainSection/Toolbar/DataSourceDropdown";
import { PA_AI_CHAT_INITIAL_MESSAGE_KEY } from "@/enterprise/components/ProductAnalytics/util";
import ChatMessageList, { TOOL_STATUS_LABELS } from "./ChatMessageList";
import { useConversationList } from "./useConversationList";
import { useChatModel } from "./useChatModel";
import { useChatFeedback } from "./useChatFeedback";
import { useAutoScroll } from "./useAutoScroll";

export default function ExplorerAIChat() {
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});
  const prevLoadingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const initialMessageRef = useRef<string | null>(
    (() => {
      const stored = sessionStorage.getItem(PA_AI_CHAT_INITIAL_MESSAGE_KEY);
      if (stored) {
        sessionStorage.removeItem(PA_AI_CHAT_INITIAL_MESSAGE_KEY);
        return stored.trim() || null;
      }
      return null;
    })(),
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled, defaultAIModel } = useAISettings();
  const permissionsUtil = usePermissionsUtil();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const { draftExploreState } = useExplorerContext();

  // -- Hooks with no cross-dependencies (safe to call first) -----------------

  const { chatModel, setChatModel } = useChatModel(defaultAIModel);

  const {
    feedbackMap,
    handleFeedbackSubmit,
    loadFeedbackFromConversation,
    clearFeedback,
    conversationIdRef: feedbackConversationIdRef,
  } = useChatFeedback();

  const buildRequestBody = useCallback(
    (message: string, cid: string) => ({
      message,
      conversationId: cid,
      datasourceId: draftExploreState.datasource,
      model: chatModel,
    }),
    [draftExploreState.datasource, chatModel],
  );

  // -- Core chat hook --------------------------------------------------------

  const {
    messages,
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
    },
    onConversationLoaded: loadFeedbackFromConversation,
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
    (messageOverride?: string) => {
      const text = (messageOverride ?? input).trim();
      if (!text) return;
      track("AI Chat Message Sent", {
        model: chatModel,
        messageCount: messages.length,
        isFirstMessage: messages.length === 0,
      });
      sendMessage(messageOverride);
    },
    [input, chatModel, messages.length, sendMessage],
  );

  // -- Effects ---------------------------------------------------------------

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  useEffect(() => {
    track("AI Chat Page Viewed", {
      hasInitialMessage: initialMessageRef.current !== null,
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    const msg = initialMessageRef.current;
    if (!msg) return;
    initialMessageRef.current = null;
    trackAndSend(msg);
  }, [trackAndSend]);

  const handleNewChat = useCallback(() => {
    track("AI Chat New Conversation", {
      previousConversationMessageCount: messages.length,
    });
    newChat();
    setChatModel(defaultAIModel);
    clearFeedback();
    refreshList();
  }, [
    newChat,
    refreshList,
    defaultAIModel,
    setChatModel,
    clearFeedback,
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        trackAndSend();
      }
    },
    [trackAndSend],
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
              size="xs"
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
        />

        <ChatInputBar
          inputRef={inputRef}
          input={input}
          onInputChange={setInput}
          onKeyDown={handleKeyDown}
          onSend={() => trackAndSend()}
          onCancel={cancelGeneration}
          loading={loading}
          isLocalStream={isLocalStream}
        />
      </Flex>
    </Flex>
  );
}
