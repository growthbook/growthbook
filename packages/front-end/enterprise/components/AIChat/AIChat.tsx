import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { PiPaperPlaneRight, PiCheckCircle } from "react-icons/pi";
import { toolResultPreviewLabel } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import {
  useAIChat,
  useChatListBackgroundPoll,
  type UseAIChatOptions,
  type ActiveTurnItem,
  type AIChatMessage,
  type ConversationSummary,
} from "@/enterprise/hooks/useAIChat";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";
import ConversationSidebar from "./ConversationSidebar";
import ToolTransparencyBlock from "./ToolTransparencyBlock";
import {
  AssistantBubble,
  UserBubble,
  ErrorBubble,
  ThinkingBubble,
  ToolStatusIcon,
} from "./AIChatPrimitives";
import aiChatPrimitives from "./AIChatPrimitives.module.scss";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AIChatProps extends UseAIChatOptions {
  title?: string;
  placeholder?: string;
  emptyStateMessage?: string;
  /** When provided, a conversation history sidebar is shown. */
  getConversationsListEndpoint?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIChat({
  title = "AI Chat",
  placeholder = "Ask a question...",
  emptyStateMessage = "Ask a question and I'll help you find answers.",
  getConversationsListEndpoint,
  onSSEEvent: callerOnSSEEvent,
  ...hookOptions
}: AIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevLoadingRef = useRef(false);
  /** Persists the open/closed state of each ToolTransparencyBlock across the
   *  activeTurnItems → messages remount that happens at turn end. */
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});

  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(getConversationsListEndpoint ?? "", {
    shouldRun: () => !!getConversationsListEndpoint,
  });

  const handleSSEEvent = useCallback(
    (event: Parameters<NonNullable<UseAIChatOptions["onSSEEvent"]>>[0]) => {
      if (event.type === "conversation-title") {
        void refreshList();
      }
      callerOnSSEEvent?.(event);
    },
    [refreshList, callerOnSSEEvent],
  );

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    newChat,
    loadConversation,
    loading,
    waitingForNextStep,
    isRemoteStream,
    error,
    input,
    setInput,
    conversationId,
  } = useAIChat({ ...hookOptions, onSSEEvent: handleSSEEvent });

  useChatListBackgroundPoll(
    listData?.conversations,
    conversationId,
    refreshList,
  );

  // Refresh the sidebar list when a streaming turn completes
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTurnItems]);

  useEffect(() => {
    inputRef.current?.focus();
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

  const handleNewChat = useCallback(() => {
    newChat();
    refreshList();
  }, [newChat, refreshList]);

  const conversations = useMemo(() => {
    const list = listData?.conversations ?? [];
    const isInList = list.some((c) => c.conversationId === conversationId);
    if (!isInList && messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      const preview =
        typeof firstUserMsg?.content === "string" ? firstUserMsg.content : "";
      return [
        {
          conversationId,
          title: "New Chat",
          createdAt: Date.now(),
          messageCount: messages.length,
          isStreaming: loading,
          preview,
        },
        ...list,
      ];
    }
    return list;
  }, [listData?.conversations, conversationId, messages, loading]);

  const renderActiveTurnItem = (item: ActiveTurnItem) => {
    if (item.kind === "text") {
      const displayedContent = displayedTextMap.get(item.id) ?? "";
      if (!displayedContent) return null;
      return (
        <AssistantBubble key={item.id}>
          <Markdown>{displayedContent}</Markdown>
        </AssistantBubble>
      );
    }
    if (item.kind === "tool-status") {
      const isError = item.status === "error";
      return (
        <AssistantBubble key={item.id}>
          <Flex align="center" gap="2">
            <ToolStatusIcon status={item.status} />
            <Text size="small" color="text-low">
              {isError && item.errorMessage ? item.errorMessage : item.label}
            </Text>
          </Flex>
          <ToolTransparencyBlock
            toolInput={item.toolInput}
            argsTextPreview={item.argsTextPreview}
            toolOutput={item.toolOutput}
            toolCallId={item.toolCallId}
            openStateRef={toolDetailsOpenRef}
          />
        </AssistantBubble>
      );
    }
    if (item.kind === "thinking") {
      return <ThinkingBubble key={item.id} label="Thinking..." />;
    }
    return null;
  };

  const renderMessage = (msg: AIChatMessage) => {
    if (msg.role === "user") {
      const userText =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter(
                (p): p is { type: "text"; text: string } => p.type === "text",
              )
              .map((p) => p.text)
              .join("\n");
      return (
        <UserBubble key={msg.id}>
          <Text size="small">{userText}</Text>
        </UserBubble>
      );
    }

    if (msg.role === "assistant") {
      const { content } = msg;
      if (typeof content === "string") {
        return (
          <AssistantBubble key={msg.id}>
            <Markdown>{content}</Markdown>
          </AssistantBubble>
        );
      }
      return content.map((part, i) => {
        if (part.type === "text") {
          return (
            <AssistantBubble key={`${msg.id}-t${i}`}>
              <Markdown>{part.text}</Markdown>
            </AssistantBubble>
          );
        }
        // tool-call parts are rendered via the matching tool-result below
        return null;
      });
    }

    if (msg.role === "tool") {
      return msg.content.map((part, i) => {
        const pairedCall = findToolCallPart(messages, part);
        const label =
          hookOptions.toolStatusLabels?.[part.toolName] ??
          toolResultPreviewLabel(part.result, part.toolName);
        return (
          <AssistantBubble key={`${msg.id}-r${i}`}>
            <Flex align="center" gap="2">
              <PiCheckCircle size={12} color="var(--green-9)" />
              <Text size="small" color="text-low">
                {label}
              </Text>
            </Flex>
            <ToolTransparencyBlock
              toolInput={pairedCall?.args}
              toolOutput={part.result}
              toolCallId={part.toolCallId}
              openStateRef={toolDetailsOpenRef}
            />
          </AssistantBubble>
        );
      });
    }

    return null;
  };

  if (!hasAISuggestions || !aiEnabled) {
    return (
      <Flex
        align="center"
        justify="center"
        direction="column"
        gap="3"
        p="6"
        style={{ height: "100%" }}
      >
        <BsStars size={28} />
        <Text align="center" color="text-mid">
          {hasAISuggestions
            ? "Org admins can enable AI in General Settings."
            : "Your current plan does not include AI Chat."}
        </Text>
      </Flex>
    );
  }

  const hasAnyContent = messages.length > 0 || activeTurnItems.length > 0;

  const chatPanel = (
    <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        style={{
          borderBottom: "1px solid var(--gray-a3)",
          background: "var(--gray-2)",
          flexShrink: 0,
        }}
      >
        <Flex align="center" gap="2">
          <BsStars size={14} />
          <Heading as="h2" size="small" weight="medium">
            {title}
          </Heading>
        </Flex>
        {!getConversationsListEndpoint && (
          <Button variant="ghost" size="xs" onClick={handleNewChat}>
            New chat
          </Button>
        )}
      </Flex>

      <Flex
        direction="column"
        gap="3"
        px="4"
        py="3"
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 120,
          minWidth: 0,
        }}
      >
        {!hasAnyContent && !loading && (
          <Flex
            align="center"
            justify="center"
            direction="column"
            gap="2"
            py="6"
          >
            <BsStars size={24} color="var(--gray-a8)" />
            <Text size="small" color="text-low" align="center">
              {emptyStateMessage}
            </Text>
          </Flex>
        )}

        {[
          ...messages.map((m) => renderMessage(m)),
          ...activeTurnItems.map(renderActiveTurnItem),
        ]}

        {loading && activeTurnItems.length === 0 && (
          <ThinkingBubble
            label={isRemoteStream ? "Still generating..." : "Thinking..."}
          />
        )}

        {loading && !isRemoteStream && waitingForNextStep && (
          <ThinkingBubble label="Planning next step..." />
        )}

        {error && (
          <ErrorBubble>
            <Text size="small">{error}</Text>
          </ErrorBubble>
        )}

        <div ref={messagesEndRef} />
      </Flex>

      <Flex
        align="end"
        gap="2"
        px="3"
        py="2"
        style={{
          borderTop: "1px solid var(--gray-a3)",
          background: "var(--gray-2)",
          flexShrink: 0,
        }}
      >
        <textarea
          ref={inputRef}
          className={aiChatPrimitives.chatTextarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={loading}
        />
        <IconButton
          type="button"
          variant="ghost"
          color="violet"
          disabled={!input.trim() || loading}
          onClick={sendMessage}
          style={{ flexShrink: 0 }}
          aria-label="Send message"
        >
          <PiPaperPlaneRight size={16} />
        </IconButton>
      </Flex>
    </Flex>
  );

  if (getConversationsListEndpoint) {
    return (
      <Flex
        style={{
          height: "calc(100vh - 150px)",
          minHeight: 0,
          background: "var(--color-background)",
          border: "1px solid var(--gray-a6)",
          borderRadius: "var(--radius-4)",
          display: "flex",
          flexDirection: "row",
          minWidth: 0,
        }}
      >
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={conversationId}
          onSelect={loadConversation}
          onNewChat={handleNewChat}
        />
        {chatPanel}
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      style={{
        height: "calc(100vh - 150px)",
        minHeight: 0,
        background: "var(--color-background)",
        border: "1px solid var(--gray-a6)",
        borderRadius: "var(--radius-4)",
        display: "flex",
        minWidth: 0,
      }}
    >
      {chatPanel}
    </Flex>
  );
}
