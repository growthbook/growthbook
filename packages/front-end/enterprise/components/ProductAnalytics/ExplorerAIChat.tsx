import React, { useRef, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiPaperPlaneRight,
  PiSparkle,
  PiCheckCircle,
  PiCircleNotch,
} from "react-icons/pi";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Markdown from "@/components/Markdown/Markdown";
import useApi from "@/hooks/useApi";
import {
  useAIChat,
  type ActiveTurnItem,
  type ChatMessage,
  type SSEEvent,
  type ConversationSummary,
} from "@/enterprise/hooks/useAIChat";
import ConversationSidebar from "@/enterprise/components/AIChat/ConversationSidebar";
import { useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";
import styles from "./ExplorerAIChat.module.scss";

const CHAT_LIST_ENDPOINT = "/product-analytics/chat";

// ---------------------------------------------------------------------------
// PA-specific types
// ---------------------------------------------------------------------------

interface ChartData {
  config: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  runExploration: "Running query...",
  getSnapshot: "Inspecting data...",
  searchMetrics: "Searching metrics...",
  getCurrentConfig: "Reading current config...",
  getConfigSchema: "Loading config schema...",
};

// ---------------------------------------------------------------------------
// Chart render helper (shared between active items and finalized messages)
// ---------------------------------------------------------------------------

function renderChart(key: string, chartData: ChartData) {
  return (
    <Box key={key} className={styles.chartMessage}>
      <Flex align="center" gap="2" mb="2">
        <PiSparkle size={12} />
        <Text size="small" weight="medium">
          Generated chart
        </Text>
      </Flex>
      <Box className={styles.chartMessageInner}>
        <ExplorerChart
          exploration={chartData.exploration}
          error={null}
          submittedExploreState={chartData.config}
          loading={false}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExplorerAIChat() {
  // Maps toolCallId → ChartData, populated from chart-result SSE events
  const chartDataRef = useRef<Map<string, ChartData>>(new Map());
  const prevLoadingRef = useRef(false);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const { draftExploreState } = useExplorerContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  // Stash chart data keyed by toolCallId so the render helpers can find it
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if (event.type === "chart-result") {
      const toolCallId = event.data.toolCallId;
      if (typeof toolCallId === "string") {
        chartDataRef.current.set(toolCallId, {
          config: event.data.config as ExplorationConfig,
          exploration:
            (event.data.exploration as ProductAnalyticsExploration) ?? null,
        });
      }
    }
  }, []);

  // Reconstruct chart data from stored tool results when loading a conversation
  const handleRawMessages = useCallback((rawMessages: unknown[]) => {
    type ToolResultPart = {
      type: string;
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    };

    for (const msg of rawMessages as Array<{
      role: string;
      content: unknown;
    }>) {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;

      for (const part of msg.content as ToolResultPart[]) {
        if (
          part.type === "tool-result" &&
          part.toolName === "runExploration" &&
          part.toolCallId &&
          part.result
        ) {
          const result = part.result as {
            config?: ExplorationConfig;
            exploration?: ProductAnalyticsExploration;
          };
          if (result.config) {
            chartDataRef.current.set(part.toolCallId, {
              config: result.config,
              exploration: result.exploration ?? null,
            });
          }
        }
      }
    }
  }, []);

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
  } = useAIChat({
    endpoint: "/product-analytics/chat",
    buildRequestBody: (message, cid) => ({
      message,
      conversationId: cid,
      datasourceId: draftExploreState.datasource,
    }),
    toolStatusLabels: TOOL_STATUS_LABELS,
    onSSEEvent: handleSSEEvent,
    onRawMessages: handleRawMessages,
    conversationStorageKey: `pa-chat-${draftExploreState.datasource ?? "default"}`,
    getConversationEndpoint: (cid) => `/product-analytics/chat/${cid}`,
  });

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(CHAT_LIST_ENDPOINT);

  // Refresh sidebar list when a streaming turn completes
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  const handleNewChat = useCallback(() => {
    chartDataRef.current = new Map();
    newChat();
    refreshList();
  }, [newChat, refreshList]);

  const handleLoadConversation = useCallback(
    (id: string) => {
      chartDataRef.current = new Map();
      return loadConversation(id);
    },
    [loadConversation],
  );

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

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

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
      // If this tool produced a chart, render it instead of just a pill
      const chartData = chartDataRef.current.get(item.toolCallId);
      if (chartData && item.status === "done") {
        return renderChart(item.toolCallId, chartData);
      }
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
    // If this tool-call produced a chart, render the chart
    if (msg.kind === "tool-call" && msg.toolCallId) {
      const chartData = chartDataRef.current.get(msg.toolCallId);
      if (chartData) {
        return renderChart(msg.toolCallId, chartData);
      }
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

  // ---------------------------------------------------------------------------
  // Gating
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Flex className={styles.layout} style={{ flexDirection: "row" }}>
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelect={handleLoadConversation}
        onNewChat={handleNewChat}
      />

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
              AI Chat
            </Heading>
          </Flex>
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
                Ask about your data, and I&apos;ll answer with analysis plus
                charts inline.
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
            placeholder="Ask about your metrics..."
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
    </Flex>
  );
}
