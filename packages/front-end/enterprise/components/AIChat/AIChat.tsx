import React, { useRef, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiPaperPlaneRight,
  PiCheckCircle,
  PiCircleNotch,
  PiWarningFill,
} from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import { toolResultPreviewLabel } from "shared/ai-chat";
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
import styles from "./AIChat.module.scss";

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
  ...hookOptions
}: AIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevLoadingRef = useRef(false);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    newChat,
    loadConversation,
    loading,
    waitingForNextStep,
    error,
    input,
    setInput,
    conversationId,
  } = useAIChat(hookOptions);

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(getConversationsListEndpoint ?? "", {
    shouldRun: () => !!getConversationsListEndpoint,
  });

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

  const renderActiveTurnItem = (item: ActiveTurnItem) => {
    if (item.kind === "text") {
      const displayedContent = displayedTextMap.get(item.id) ?? "";
      if (!displayedContent) return null;
      return (
        <Box key={item.id} className={styles.assistantMessage}>
          <Markdown>{displayedContent}</Markdown>
        </Box>
      );
    }
    if (item.kind === "tool-status") {
      const isError = item.status === "error";
      return (
        <Box key={item.id} className={styles.assistantMessage}>
          <Flex align="center" gap="2">
            {item.status === "running" ? (
              <span className={styles.spinIcon}>
                <PiCircleNotch size={12} />
              </span>
            ) : isError ? (
              <PiWarningFill size={12} color="var(--amber-11)" />
            ) : (
              <PiCheckCircle size={12} color="var(--green-9)" />
            )}
            <Text size="small" color="text-low">
              {isError && item.errorMessage ? item.errorMessage : item.label}
            </Text>
          </Flex>
          <ToolTransparencyBlock
            toolInput={item.toolInput}
            argsTextPreview={item.argsTextPreview}
            toolOutput={item.toolOutput}
          />
        </Box>
      );
    }
    if (item.kind === "thinking") {
      return (
        <Box key={item.id} className={styles.assistantMessage}>
          <Flex align="center" gap="2">
            <span className={styles.spinIcon}>
              <PiCircleNotch size={12} />
            </span>
            <Text size="small" color="text-low">
              Thinking...
            </Text>
          </Flex>
        </Box>
      );
    }
    return null;
  };

  const renderMessage = (msg: AIChatMessage) => {
    if (msg.role === "user") {
      const userText =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("\n");
      return (
        <Box key={msg.id} className={styles.userMessage}>
          <Text size="small">{userText}</Text>
        </Box>
      );
    }

    if (msg.role === "assistant") {
      const { content } = msg;
      if (typeof content === "string") {
        return (
          <Box key={msg.id} className={styles.assistantMessage}>
            <Markdown>{content}</Markdown>
          </Box>
        );
      }
      return content.map((part, i) => {
        if (part.type === "text") {
          return (
            <Box key={`${msg.id}-t${i}`} className={styles.assistantMessage}>
              <Markdown>{part.text}</Markdown>
            </Box>
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
          <Box key={`${msg.id}-r${i}`} className={styles.assistantMessage}>
            <Flex align="center" gap="2">
              <PiCheckCircle size={12} color="var(--green-9)" />
              <Text size="small" color="text-low">
                {label}
              </Text>
            </Flex>
            <ToolTransparencyBlock
              toolInput={pairedCall?.args}
              toolOutput={part.result}
            />
          </Box>
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
        className={styles.emptyOutput}
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
  const conversations = listData?.conversations ?? [];

  const chatPanel = (
    <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className={styles.chatHeader}
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
        className={styles.chatMessages}
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
          <Box className={styles.assistantMessage}>
            <Flex align="center" gap="2">
              <span className={styles.spinIcon}>
                <PiCircleNotch size={12} />
              </span>
              <Text size="small" color="text-low">
                Thinking...
              </Text>
            </Flex>
          </Box>
        )}

        {loading && waitingForNextStep && (
          <Box className={styles.assistantMessage}>
            <Flex align="center" gap="2">
              <span className={styles.spinIcon}>
                <PiCircleNotch size={12} />
              </span>
              <Text size="small" color="text-low">
                Planning next step...
              </Text>
            </Flex>
          </Box>
        )}

        {error && (
          <Box className={styles.errorMessage}>
            <Text size="small">{error}</Text>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Flex>

      <Flex align="end" gap="2" px="3" py="2" className={styles.chatInput}>
        <textarea
          ref={inputRef}
          className={styles.chatTextarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={loading}
        />
        <button
          className={styles.sendButton}
          onClick={sendMessage}
          disabled={!input.trim() || loading}
        >
          <PiPaperPlaneRight size={16} />
        </button>
      </Flex>
    </Flex>
  );

  if (getConversationsListEndpoint) {
    return (
      <Flex className={styles.layout} style={{ flexDirection: "row" }}>
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
    <Flex direction="column" className={styles.layout}>
      {chatPanel}
    </Flex>
  );
}
