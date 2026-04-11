import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import {
  PiSparkle,
  PiArrowRightBold,
  PiArrowLineLeft,
  PiArrowLineRight,
  PiStop,
} from "react-icons/pi";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { encodeExplorationConfig } from "shared/enterprise";
import { toolResultPreviewLabel } from "shared/ai-chat";
import type { AIPromptInterface } from "shared/ai";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import OptInModal from "@/components/License/OptInModal";
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
import LinkButton from "@/ui/LinkButton";
import { isCloud } from "@/services/env";
import { getAvailableAIModelOptions } from "@/services/aiModelSelectOptions";
import Tooltip from "@/ui/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import { useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";
import SaveToDashboardModal from "./SaveToDashboardModal";
import {
  PA_AI_CHAT_INITIAL_MESSAGE_KEY,
  PA_AI_CHAT_INITIAL_MODEL_KEY,
} from "./util";

const CHAT_LIST_ENDPOINT = "/product-analytics/chat";

function explorerPaChatModelOptions(): (
  | { value: string; label: string }
  | { label: string; options: { value: string; label: string }[] }
)[] {
  return getAvailableAIModelOptions();
}

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

const EXPLORER_PATHS: Record<ExplorationConfig["type"], string> = {
  metric: "/product-analytics/explore/metrics",
  fact_table: "/product-analytics/explore/fact-table",
  data_source: "/product-analytics/explore/data-source",
};

function ChartBubble({
  chartData,
  toolTransparency,
  animate = true,
}: ChartBubbleProps) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const explorerUrl = `${EXPLORER_PATHS[chartData.config.type]}?config=${encodeExplorationConfig(chartData.config)}`;

  return (
    <AssistantBubble wide>
      {showSaveModal && (
        <SaveToDashboardModal
          close={() => setShowSaveModal(false)}
          config={chartData.config}
          exploration={chartData.exploration}
        />
      )}
      <Flex align="center" gap="2" mb="2">
        <PiSparkle size={12} />
        <Text size="small" weight="medium">
          Generated chart
        </Text>
        <Flex ml="auto" gap="1">
          <Button
            variant="ghost"
            size="xs"
            color="violet"
            onClick={() => setShowSaveModal(true)}
          >
            Save to Dashboard
          </Button>
          <LinkButton
            href={explorerUrl}
            variant="ghost"
            size="xs"
            color="violet"
          >
            Open in Explorer
          </LinkButton>
        </Flex>
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
  const [showAiOptInModal, setShowAiOptInModal] = useState(false);
  const [chatTitles, setChatTitles] = useState<Record<string, string>>({});

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

  const paChatModelSelectOptions = useMemo(() => {
    return explorerPaChatModelOptions();
  }, []);

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
    conversationStorageKey: "pa-ai-chat-conversation-id",
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

  const handleNewChat = useCallback(() => {
    newChat();
    setChatModel(defaultAIModel);
    refreshList();
  }, [newChat, refreshList, defaultAIModel]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await apiCall(`/product-analytics/chat/${id}`, { method: "DELETE" });
        if (id === conversationId) {
          newChat();
        }
        await refreshList();
      } catch {
        // silently ignore — list will stay unchanged
      }
    },
    [apiCall, conversationId, newChat, refreshList],
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

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeTurnItems]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [conversationId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    const msg = initialMessageRef.current;
    if (!msg) return;
    initialMessageRef.current = null;
    sendMessage(msg);
  }, [sendMessage]);

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
      return (
        <AssistantBubble key={item.toolCallId}>
          <Flex align="center" gap="2">
            <ToolStatusIcon status={item.status} />
            <Text size="small" color="text-low">
              {item.label}
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
      if (msg.isError) {
        const errorText =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter(
                  (p): p is { type: "text"; text: string } => p.type === "text",
                )
                .map((p) => p.text)
                .join("\n");
        return (
          <ErrorBubble key={msg.id}>
            <Text size="small">{errorText}</Text>
          </ErrorBubble>
        );
      }

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
              <ToolStatusIcon status={part.isError ? "error" : "done"} />
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
      <Flex style={{ height: "80vh" }} align="center" justify="center">
        {showAiOptInModal ? (
          <OptInModal
            agreement="ai"
            onClose={() => setShowAiOptInModal(false)}
          />
        ) : null}
        <Flex align="center" justify="center" direction="column" gap="3" p="6">
          <BsStars size={28} />
          {!hasAISuggestions ? (
            <Text align="center" color="text-mid">
              Your current plan does not include AI Chat.
            </Text>
          ) : permissionsUtil.canManageOrgSettings() ? (
            <>
              <Text align="center" color="text-mid">
                Enable AI for your organization to use AI Chat here and across
                GrowthBook.
              </Text>
              <Flex gap="2" direction="column" pt="4">
                <Button
                  color="violet"
                  onClick={() => setShowAiOptInModal(true)}
                >
                  Enable AI
                </Button>
                <LinkButton href="/settings/#ai" variant="ghost" color="violet">
                  Open General Settings
                </LinkButton>
              </Flex>
            </>
          ) : (
            <Text align="center" color="text-mid">
              AI Chat is not enabled for your organization. Ask an org admin to
              enable AI in General Settings.
            </Text>
          )}
        </Flex>
      </Flex>
    );
  }

  const hasAnyContent = messages.length > 0 || activeTurnItems.length > 0;

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
          ref={scrollContainerRef}
          onScroll={handleScroll}
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
            <ThinkingBubble
              label={
                isLoadingConversation
                  ? "Loading conversation..."
                  : isRemoteStream
                    ? "Still generating..."
                    : "Thinking..."
              }
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
          direction="column"
          gap="4"
          py="5"
          align="center"
          justify="center"
          px="9"
          style={{
            borderTop: "1px solid var(--gray-a3)",
            background: "var(--color-panel-solid)",
          }}
        >
          <Flex gap="2" width="100%" align="center" justify="center">
            {!isCloud() && (
              <Tooltip
                enabled={!!modelDisabledReason}
                content={modelDisabledReason ?? ""}
              >
                <span
                  style={
                    modelDisabledReason ? { cursor: "not-allowed" } : undefined
                  }
                >
                  <SelectField
                    id="explorer-ai-chat-model"
                    value={canPickModel ? chatModel : orgPaChatOverrideModel}
                    onChange={(v) => {
                      if (canPickModel && !chatHasMessages) setChatModel(v);
                    }}
                    options={paChatModelSelectOptions}
                    disabled={!!modelDisabledReason}
                    placeholder="AI model"
                    formatOptionLabel={(option, { context }) => {
                      if (
                        option.value === defaultAIModel &&
                        context === "menu"
                      ) {
                        return (
                          <Flex direction="column" gap="0">
                            <Text>{option.label}</Text>
                            <span
                              style={{
                                color: "var(--text-color-muted)",
                                fontSize: "var(--font-size-1)",
                              }}
                            >
                              Organization Default
                            </span>
                          </Flex>
                        );
                      }
                      return <span>{option.label}</span>;
                    }}
                    containerStyle={{
                      marginBottom: 0,
                      ...(modelDisabledReason
                        ? { pointerEvents: "none" }
                        : undefined),
                    }}
                    containerStyles={{
                      control: (styles) => ({
                        ...styles,
                        width: "150px",
                        minHeight: "35px",
                        height: "35px",
                      }),
                      valueContainer: (styles) => ({
                        ...styles,
                        paddingTop: 0,
                        paddingBottom: 0,
                      }),
                      indicatorsContainer: (styles) => ({
                        ...styles,
                        height: "35px",
                      }),
                    }}
                  />
                </span>
              </Tooltip>
            )}
            <Field
              placeholder="Ask about metrics, experiments, or setup..."
              containerStyle={{ maxWidth: "800px", flex: 1 }}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            {isLocalStream ? (
              <Button onClick={cancelGeneration} title="Cancel generation">
                <PiStop size={16} />
              </Button>
            ) : (
              <Button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
              >
                <PiArrowRightBold size={16} />
              </Button>
            )}
          </Flex>
        </Flex>
      </Flex>
    </Flex>
  );
}
