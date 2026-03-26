import React, { useRef, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiPaperPlaneRight,
  PiCheckCircle,
  PiCircleNotch,
} from "react-icons/pi";
import Markdown from "@/components/Markdown/Markdown";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import {
  useAIChat,
  type UseAIChatOptions,
  type ActiveTurnItem,
  type ChatMessage,
} from "@/enterprise/hooks/useAIChat";
import styles from "./AIChat.module.scss";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AIChatProps extends UseAIChatOptions {
  title?: string;
  placeholder?: string;
  emptyStateMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIChat({
  title = "AI Chat",
  placeholder = "Ask a question...",
  emptyStateMessage = "Ask a question and I'll help you find answers.",
  ...hookOptions
}: AIChatProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const {
    messages,
    activeTurnItems,
    displayedTextMap,
    sendMessage,
    newChat,
    loading,
    waitingForNextStep,
    error,
    input,
    setInput,
  } = useAIChat(hookOptions);

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
      return (
        <Box key={item.id} className={styles.assistantMessage}>
          <Flex align="center" gap="2">
            {item.status === "running" ? (
              <span className={styles.spinIcon}>
                <PiCircleNotch size={12} />
              </span>
            ) : (
              <PiCheckCircle size={12} color="var(--green-9)" />
            )}
            <Text size="small" color="text-low">
              {item.label}
            </Text>
          </Flex>
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

  const renderMessage = (msg: ChatMessage) => {
    if (msg.kind === "tool-call") {
      return (
        <Box key={msg.id} className={styles.assistantMessage}>
          <Flex align="center" gap="2">
            <PiCheckCircle size={12} color="var(--green-9)" />
            <Text size="small" color="text-low">
              {msg.toolLabel}
            </Text>
          </Flex>
        </Box>
      );
    }

    return (
      <Box
        key={msg.id}
        className={
          msg.role === "user" ? styles.userMessage : styles.assistantMessage
        }
      >
        {msg.role === "assistant" ? (
          <Markdown>{msg.content}</Markdown>
        ) : (
          <Text size="small">{msg.content}</Text>
        )}
      </Box>
    );
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

  return (
    <Flex direction="column" className={styles.layout}>
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
        <Button variant="ghost" size="xs" onClick={newChat}>
          New chat
        </Button>
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
          ...messages.map(renderMessage),
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
}
