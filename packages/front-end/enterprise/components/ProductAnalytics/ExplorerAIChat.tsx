import React, { useRef, useEffect, useCallback, useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiSparkle,
  PiCheckCircle,
  PiLightning,
  PiUserCircle,
  PiChartLine,
  PiArrowsLeftRight,
  PiArrowRightBold,
  PiArrowLineLeft,
  PiArrowLineRight,
} from "react-icons/pi";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { toolResultPreviewLabel } from "shared/ai-chat";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Markdown from "@/components/Markdown/Markdown";
import useApi from "@/hooks/useApi";
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
import {
  AssistantBubble,
  UserBubble,
  ErrorBubble,
  ThinkingBubble,
  ToolStatusIcon,
  AIAnalystLabel,
} from "@/enterprise/components/AIChat/AIChatPrimitives";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import { useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";

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
  search: "Searching...",
  getAvailableColumns: "Inspecting data shape...",
  getColumnValues: "Inspecting values...",
  getCurrentConfig: "Reading current config...",
  getConfigSchema: "Loading config schema...",
};

const QUICK_ACTIONS: {
  label: string;
  icon: React.ReactNode;
  prompt: string;
}[] = [
  {
    label: "User Growth",
    icon: <PiUserCircle size={16} />,
    prompt: "Show me user growth trends over time",
  },
  {
    label: "Conversion Analysis",
    icon: <PiChartLine size={16} />,
    prompt: "Analyze conversion rates across key funnel steps",
  },
  {
    label: "Revenue Trends",
    icon: <PiArrowsLeftRight size={16} />,
    prompt: "Show revenue trends over the last 30 days",
  },
  {
    label: "Top Metrics",
    icon: <PiChartLine size={16} />,
    prompt: "What are our top performing metrics right now?",
  },
];

function groupIntoBlocks(
  msgs: AIChatMessage[],
): { type: "user" | "assistant"; msgs: AIChatMessage[] }[] {
  const blocks: { type: "user" | "assistant"; msgs: AIChatMessage[] }[] = [];
  for (const msg of msgs) {
    const type = msg.role === "user" ? "user" : "assistant";
    if (!blocks.length || blocks[blocks.length - 1].type !== type) {
      blocks.push({ type, msgs: [msg] });
    } else {
      blocks[blocks.length - 1].msgs.push(msg);
    }
  }
  return blocks;
}

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
  return { config, exploration };
}

// ---------------------------------------------------------------------------
// ChartBubble — PA-specific chart result rendered as a message bubble
// ---------------------------------------------------------------------------

interface ChartBubbleProps {
  chartData: ChartData;
  toolTransparency?: React.ReactNode;
  /** Passed through to ExplorerChart — set false for already-seen charts to skip re-animation. */
  animate?: boolean;
}

function ChartBubble({
  chartData,
  toolTransparency,
  animate = true,
}: ChartBubbleProps) {
  return (
    <AssistantBubble wide>
      <Flex align="center" gap="2" mb="2">
        <PiSparkle size={12} />
        <Text size="small" weight="medium">
          Generated chart
        </Text>
      </Flex>
      <Box style={{ height: 360, minHeight: 260, display: "flex" }}>
        <ExplorerChart
          exploration={chartData.exploration}
          error={chartData.exploration?.error ?? null}
          submittedExploreState={chartData.config}
          loading={false}
          animate={animate}
        />
      </Box>
      {toolTransparency ? (
        <Box
          style={{
            marginTop: "var(--space-2)",
            paddingTop: "var(--space-2)",
            borderTop: "1px solid var(--gray-a5)",
          }}
        >
          {toolTransparency}
        </Box>
      ) : null}
    </AssistantBubble>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExplorerAIChat() {
  const prevLoadingRef = useRef(false);
  /** Persists the open/closed state of each ToolTransparencyBlock across the
   *  activeTurnItems → messages remount that happens at turn end. */
  const toolDetailsOpenRef = useRef<Record<string, boolean>>({});

  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      refreshList();
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshList]);

  const handleNewChat = useCallback(() => {
    newChat();
    refreshList();
  }, [newChat, refreshList]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTurnItems]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const handleQuickAction = useCallback(
    (prompt: string) => {
      setInput(prompt);
      inputRef.current?.focus();
    },
    [setInput],
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

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
      const chartData = item.toolResultData
        ? chartDataFromRecord(item.toolResultData)
        : null;
      if (chartData && item.status === "done") {
        return (
          <ChartBubble
            key={item.toolCallId}
            chartData={chartData}
            toolTransparency={
              <ToolTransparencyBlock
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
      const isError = item.status === "error";
      return (
        <AssistantBubble key={item.toolCallId}>
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
      const timestamp = msg.ts
        ? new Date(msg.ts)
            .toLocaleString("en-US", {
              month: "2-digit",
              day: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
            .replace(",", " -")
        : null;
      return (
        <React.Fragment key={msg.id}>
          <UserBubble>
            <Text color="text-high" size="small">
              {userText}
            </Text>
          </UserBubble>
          {timestamp && (
            <Box
              style={{
                alignSelf: "flex-end",
                marginTop: "-8px",
                paddingRight: "2px",
              }}
            >
              <Text size="small" color="text-low">
                {timestamp}
              </Text>
            </Box>
          )}
        </React.Fragment>
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
              <ChartBubble
                key={`${msg.id}-r${i}`}
                chartData={chartData}
                animate={false}
                toolTransparency={
                  <ToolTransparencyBlock
                    embedded
                    summaryLabel="Query & tool response"
                    toolInput={pairedCall?.args}
                    toolOutput={part.result}
                    toolCallId={part.toolCallId}
                    openStateRef={toolDetailsOpenRef}
                  />
                }
              />
            );
          }
        }

        return (
          <AssistantBubble key={`${msg.id}-r${i}`}>
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
              toolCallId={part.toolCallId}
              openStateRef={toolDetailsOpenRef}
            />
          </AssistantBubble>
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
  const conversations = listData?.conversations ?? [];

  const messageBlocks = groupIntoBlocks(messages);
  const lastBlockIsAssistant =
    messageBlocks.length > 0 &&
    messageBlocks[messageBlocks.length - 1].type === "assistant";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Flex
      style={{
        height: "calc(100vh - 56px)",
        minHeight: 0,
        background: "var(--color-background)",
        border: "1px solid var(--gray-a6)",
        flexDirection: "row",
        minWidth: 0,
      }}
    >
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelect={loadConversation}
        onNewChat={handleNewChat}
        collapsed={!sidebarOpen}
      />

      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        <Flex
          align="center"
          justify="between"
          px="4"
          py="3"
          style={{
            borderBottom: "1px solid var(--gray-a3)",
            background: "var(--color-panel-solid)",
            flexShrink: 0,
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
              style={{ height: "100%" }}
            >
              <Box
                style={{
                  background: "var(--violet-a3)",
                  borderRadius: "999px",
                  padding: "8px 12px",
                }}
              >
                <PiSparkle size={24} color="var(--violet-11)" />
              </Box>
              <Heading as="h2" size="small" weight="medium">
                What would you like to explore?
              </Heading>
              <Text size="small" color="text-low" align="center">
                Ask anything about your data.
              </Text>
              <Text size="small" color="text-low" align="center">
                Explore metrics, trends, experiment results, or user segments.
              </Text>
            </Flex>
          )}

          {messageBlocks.flatMap((block, blockIdx) => {
            const renderedMsgs = block.msgs.flatMap((m) => {
              const result = renderMessage(m);
              if (Array.isArray(result)) return result;
              return result != null ? [result] : [];
            });
            if (block.type === "assistant") {
              return [
                <AIAnalystLabel key={`ai-label-${blockIdx}`} />,
                ...renderedMsgs,
              ];
            }
            return renderedMsgs;
          })}

          {(activeTurnItems.length > 0 ||
            (loading && activeTurnItems.length === 0)) &&
            !lastBlockIsAssistant && <AIAnalystLabel />}

          {activeTurnItems.map(renderActiveTurnItem)}

          {loading && activeTurnItems.length === 0 && (
            <ThinkingBubble label="Thinking..." />
          )}

          {loading && waitingForNextStep && (
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
          direction="column"
          gap="4"
          py="5"
          align="center"
          justify="center"
          style={{
            borderTop: "1px solid var(--gray-a3)",
            background: "var(--color-panel-solid)",
          }}
        >
          <Flex align="center" gap="1">
            <Flex align="center" gap="1" mr="2">
              <PiLightning size={16} />
              <Text size="small" color="text-low" weight="semibold">
                Quick actions:
              </Text>
            </Flex>
            <Flex align="center" gap="2">
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  size="xs"
                  onClick={() => handleQuickAction(action.prompt)}
                >
                  <Flex align="center" gap="1">
                    {action.icon}
                    {action.label}
                  </Flex>
                </Button>
              ))}
            </Flex>
          </Flex>

          <Flex px="2" gap="2" width="100%" align="center" justify="center">
            {/* TODO: fix width on smaller screens */}
            <Field
              placeholder="Ask about metrics, experiments, or setup..."
              style={{ width: "624px" }}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <Button onClick={sendMessage} disabled={!input.trim() || loading}>
              <PiArrowRightBold size={16} />
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Flex>
  );
}
