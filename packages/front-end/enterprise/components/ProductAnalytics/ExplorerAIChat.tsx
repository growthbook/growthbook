import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowLineLeft, PiArrowLineRight } from "react-icons/pi";
import {
  type AIChatFeedbackRating,
  type AIChatFeedbackEntry,
} from "shared/validators";
import type { AIPromptInterface } from "shared/ai";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";
import { isCloud } from "@/services/env";
import {
  useAIChat,
  useChatListBackgroundPoll,
  type ConversationSummary,
} from "@/enterprise/hooks/useAIChat";
import ConversationSidebar from "@/enterprise/components/AIChat/ConversationSidebar";
import AIChatGatingScreen from "@/enterprise/components/AIChat/AIChatGatingScreen";
import ChatInputBar from "@/enterprise/components/AIChat/ChatInputBar";
import type { FeedbackState } from "@/enterprise/components/AIChat/AIChatFeedback";
import { useExplorerContext } from "./ExplorerContext";
import ChatMessageList, { TOOL_STATUS_LABELS } from "./ChatMessageList";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";
import {
  PA_AI_CHAT_INITIAL_MESSAGE_KEY,
  PA_AI_CHAT_INITIAL_MODEL_KEY,
} from "./util";

const CHAT_LIST_ENDPOINT = "/product-analytics/chat";

export default function ExplorerAIChat() {
  const prevLoadingRef = useRef(false);
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});

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
  const [chatTitles, setChatTitles] = useState<Record<string, string>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackState>>(
    {},
  );

  const { hasCommercialFeature } = useUser();
  const { aiEnabled, defaultAIModel } = useAISettings();

  const [chatModel, setChatModel] = useState(() => {
    const stored = sessionStorage.getItem(PA_AI_CHAT_INITIAL_MODEL_KEY);
    if (stored) {
      sessionStorage.removeItem(PA_AI_CHAT_INITIAL_MODEL_KEY);
      return stored;
    }
    return defaultAIModel;
  });
  const permissionsUtil = usePermissionsUtil();
  const canPickModel = permissionsUtil.canManageOrgSettings();
  const { draftExploreState } = useExplorerContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const { apiCall } = useAuth();

  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    `/ai/prompts`,
    { shouldRun: () => !isCloud() },
  );

  const orgPaChatOverrideModel = useMemo(() => {
    if (!promptsData?.prompts) return "";
    return (
      promptsData.prompts.find((p) => p.type === "product-analytics-chat")
        ?.overrideModel ?? ""
    );
  }, [promptsData]);

  const buildRequestBody = useCallback(
    (message: string, cid: string) => ({
      message,
      conversationId: cid,
      datasourceId: draftExploreState.datasource,
      model: chatModel,
    }),
    [draftExploreState.datasource, chatModel],
  );

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(CHAT_LIST_ENDPOINT);

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
        if (title) {
          setChatTitles((prev) => ({ ...prev, [conversationId]: title }));
        }
        void refreshList();
      }
    },
    onConversationLoaded: (data) => {
      const entries = (data as { feedback?: AIChatFeedbackEntry[] }).feedback;
      if (!entries?.length) {
        setFeedbackMap({});
        return;
      }
      const map: Record<string, FeedbackState> = {};
      for (const entry of entries) {
        map[entry.messageId] = {
          rating: entry.rating,
          comment: entry.comment,
        };
      }
      setFeedbackMap(map);
    },
  });

  useChatListBackgroundPoll(
    listData?.conversations,
    conversationId,
    refreshList,
  );

  const chatHasMessages = messages.length > 0;
  const modelDisabledReason = !canPickModel
    ? "Only users with permission to manage organization settings can change the model here. Organization admins can set defaults in General Settings → AI Settings."
    : chatHasMessages
      ? "The model can't be changed mid-conversation. Start a new chat to use a different model."
      : null;

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTurnItems]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    inputRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    const msg = initialMessageRef.current;
    if (!msg) return;
    initialMessageRef.current = null;
    sendMessage(msg);
  }, [sendMessage]);

  const handleNewChat = useCallback(() => {
    newChat();
    setChatModel(defaultAIModel);
    setFeedbackMap({});
    refreshList();
  }, [newChat, refreshList, defaultAIModel]);

  const handleFeedbackSubmit = useCallback(
    (
      messageId: string,
      rating: AIChatFeedbackRating | null,
      comment: string,
    ) => {
      setFeedbackMap((prev) => {
        if (rating === null) {
          const next = { ...prev };
          delete next[messageId];
          return next;
        }
        return { ...prev, [messageId]: { rating, comment } };
      });

      void apiCall(`/product-analytics/chat/${conversationId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ messageId, rating, comment }),
      });
    },
    [apiCall, conversationId],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await apiCall(`/product-analytics/chat/${id}`, { method: "DELETE" });
        if (id === conversationId) {
          newChat();
        }
        await refreshList();
      } catch {
        // silently ignore
      }
    },
    [apiCall, conversationId, newChat, refreshList],
  );

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const conversations = useMemo(() => {
    const list = listData?.conversations ?? [];
    const applyTitleOverrides = (
      items: ConversationSummary[],
    ): ConversationSummary[] => {
      if (!Object.keys(chatTitles).length) return items;
      return items.map((c) => {
        const override = chatTitles[c.conversationId];
        return override ? { ...c, title: override } : c;
      });
    };

    const isInList = list.some((c) => c.conversationId === conversationId);
    if (!isInList && messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      const preview =
        typeof firstUserMsg?.content === "string" ? firstUserMsg.content : "";
      return [
        {
          conversationId,
          title: chatTitles[conversationId] ?? "New Chat",
          createdAt: Date.now(),
          messageCount: messages.length,
          isStreaming: loading,
          preview,
        },
        ...applyTitleOverrides(list),
      ];
    }
    return applyTitleOverrides(list);
  }, [listData?.conversations, conversationId, messages, loading, chatTitles]);

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
          void loadConversation(id);
          const conv = listData?.conversations.find(
            (c) => c.conversationId === id,
          );
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
          conversationId={conversationId}
          feedbackMap={feedbackMap}
          onFeedbackSubmit={handleFeedbackSubmit}
          toolDetailsOpenRef={toolDetailsOpenRef}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
        />

        <ChatInputBar
          modelSelectId="explorer-ai-chat-model"
          modelValue={canPickModel ? chatModel : orgPaChatOverrideModel}
          onModelChange={setChatModel}
          modelDisabledReason={modelDisabledReason}
          inputRef={inputRef}
          input={input}
          onInputChange={setInput}
          onKeyDown={handleKeyDown}
          onSend={() => sendMessage()}
          onCancel={cancelGeneration}
          loading={loading}
          isLocalStream={isLocalStream}
        />
      </Flex>
    </Flex>
  );
}
