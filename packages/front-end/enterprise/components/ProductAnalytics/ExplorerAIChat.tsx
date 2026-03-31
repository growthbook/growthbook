import React, { useRef, useEffect, useCallback } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiPaperPlaneRight,
  PiSparkle,
  PiCheckCircle,
  PiCircleNotch,
  PiWarningFill,
} from "react-icons/pi";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Markdown from "@/components/Markdown/Markdown";
import useApi from "@/hooks/useApi";
import { toolResultPreviewLabel } from "shared/ai-chat";
import {
  useAIChat,
  useChatListBackgroundPoll,
  type ActiveTurnItem,
  type AIChatMessage,
  type ConversationSummary,
} from "@/enterprise/hooks/useAIChat";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";
import ConversationSidebar from "@/enterprise/components/AIChat/ConversationSidebar";
import ToolTransparencyBlock from "@/enterprise/components/AIChat/ToolTransparencyBlock";
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

function chartDataFromToolResult(result: unknown): ChartData | null {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return chartDataFromRecord(parsed as Record<string, unknown>);
      }
    } catch {
      return null;
    }
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  return chartDataFromRecord(result as Record<string, unknown>);
}

function chartDataFromRecord(data: Record<string, unknown>): ChartData | null {
  const exploration =
    (data.exploration as ProductAnalyticsExploration | null) ?? null;
  let config = data.config as ExplorationConfig | undefined;
  if ((!config || typeof config !== "object") && exploration?.config) {
    config = exploration.config as ExplorationConfig;
  }
  if (!config || typeof config !== "object") return null;
  return {
    config,
    exploration,
  };
}

// ---------------------------------------------------------------------------
// Chart render helper (shared between active items and finalized messages)
// ---------------------------------------------------------------------------

function renderChart(chartData: ChartData, toolTransparency?: React.ReactNode) {
  return (
    <Box className={styles.chartMessage}>
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
      {toolTransparency ? (
        <Box className={styles.chartToolTransparency}>{toolTransparency}</Box>
      ) : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExplorerAIChat() {
  const prevLoadingRef = useRef(false);

  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const { draftExploreState } = useExplorerContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const { data: listData, mutate: refreshList } = useApi<{
    conversations: ConversationSummary[];
  }>(CHAT_LIST_ENDPOINT);

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
    conversationStorageKey: `pa-chat-${draftExploreState.datasource ?? "default"}`,
    getConversationEndpoint: (cid) => `/product-analytics/chat/${cid}`,
    onStreamAccepted: () => {
      void refreshList();
    },
  });

  useChatListBackgroundPoll(
    listData?.conversations,
    conversationId,
    refreshList,
  );

  // Refresh sidebar list when a streaming turn completes
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  const handleNewChat = useCallback(() => {
    newChat();
    refreshList();
  }, [newChat, refreshList]);

  const handleLoadConversation = useCallback(
    (id: string) => {
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
      const chartData = item.toolResultData
        ? chartDataFromRecord(item.toolResultData)
        : null;
      const isError = item.status === "error";
      if (chartData && item.status === "done") {
        return (
          <Box key={item.toolCallId}>
            {renderChart(
              chartData,
              <ToolTransparencyBlock
                embedded
                summaryLabel="Query & tool response"
                toolInput={item.toolInput}
                argsTextPreview={item.argsTextPreview}
                toolOutput={item.toolOutput}
              />,
            )}
          </Box>
        );
      }
      return (
        <Box key={item.toolCallId} className={styles.assistantMessage}>
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
        // tool-call parts are rendered via their matching tool-result below
        return null;
      });
    }

    if (msg.role === "tool") {
      return msg.content.map((part, i) => {
        const pairedCall = findToolCallPart(messages, part);

        if (part.toolName === "runExploration") {
          const chartData = chartDataFromToolResult(part.result);
          if (chartData) {
            return (
              <Box key={`${msg.id}-r${i}`}>
                {renderChart(
                  chartData,
                  <ToolTransparencyBlock
                    embedded
                    summaryLabel="Query & tool response"
                    toolInput={pairedCall?.args}
                    toolOutput={part.result}
                  />,
                )}
              </Box>
            );
          }
        }

        return (
          <Box key={`${msg.id}-r${i}`} className={styles.assistantMessage}>
            <Flex align="center" gap="2">
              <PiCheckCircle size={12} color="var(--green-9)" />
              <Text size="small" color="text-low">
                {TOOL_STATUS_LABELS[part.toolName] ??
                  toolResultPreviewLabel(part.result, part.toolName)}
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
