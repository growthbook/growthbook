import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { PiSparkle } from "react-icons/pi";
import { toolResultPreviewLabel, getMessageText } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import { formatTimestamp } from "@/services/dates";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import type {
  ActiveTurnItem,
  AIChatMessage,
} from "@/enterprise/hooks/useAIChat";
import { findToolCallPart } from "@/enterprise/hooks/useAIChat/pairAIChatToolMessages";
import ToolUsageDetails from "@/enterprise/components/AIChat/ToolUsageDetails";
import {
  AIChatFeedback,
  type FeedbackState,
} from "@/enterprise/components/AIChat/AIChatFeedback";
import {
  AssistantBubble,
  UserBubble,
  ErrorBubble,
  ThinkingBubble,
  ToolStatusIcon,
  AIAnalystLabel,
} from "@/enterprise/components/AIChat/AIChatPrimitives";
import ExplorationBubble, {
  chartDataFromToolResult,
  chartDataFromRecord,
} from "./ExplorationBubble";

export const TOOL_STATUS_LABELS: Record<string, string> = {
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

interface ChatMessageListProps {
  messages: AIChatMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  loading: boolean;
  isLoadingConversation: boolean;
  isRemoteStream: boolean;
  waitingForNextStep: boolean;
  error: string | null;
  conversationId: string;
  feedbackMap: Record<string, FeedbackState>;
  onFeedbackSubmit: (
    messageId: string,
    rating: "positive" | "negative" | null,
    comment: string,
  ) => void;
  toolDetailsOpenRef: React.MutableRefObject<Record<string, boolean>>;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}

export default function ChatMessageList({
  messages,
  activeTurnItems,
  displayedTextMap,
  loading,
  isLoadingConversation,
  isRemoteStream,
  waitingForNextStep,
  error,
  conversationId,
  feedbackMap,
  onFeedbackSubmit,
  toolDetailsOpenRef,
  scrollContainerRef,
  messagesEndRef,
  onScroll,
}: ChatMessageListProps) {
  const hasAnyContent = messages.length > 0 || activeTurnItems.length > 0;
  const messageBlocks = groupIntoBlocks(messages);
  const lastBlockIsAssistant =
    messageBlocks.length > 0 &&
    messageBlocks[messageBlocks.length - 1].type === "assistant";

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
          <ExplorationBubble
            key={item.toolCallId}
            chartData={chartData}
            toolTransparency={
              <ToolUsageDetails
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
          <ToolUsageDetails
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
      const userText = getMessageText(msg);
      const timestamp = msg.ts ? formatTimestamp(msg.ts) : null;
      return (
        <React.Fragment key={msg.id}>
          <UserBubble>
            <Text color="text-high" size="small">
              {userText}
            </Text>
          </UserBubble>
          {timestamp && (
            <Box pr="1" style={{ alignSelf: "flex-end", marginTop: "-8px" }}>
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
        return (
          <ErrorBubble key={msg.id}>
            <Text size="small">{getMessageText(msg)}</Text>
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
              <ExplorationBubble
                key={`${msg.id}-r${i}`}
                chartData={chartData}
                animate={false}
                toolTransparency={
                  <ToolUsageDetails
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
            <ToolUsageDetails
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

  return (
    <Flex
      ref={scrollContainerRef}
      onScroll={onScroll}
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
            px="3"
            py="2"
            style={{
              background: "var(--violet-a3)",
              borderRadius: "999px",
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
          const lastMsg = block.msgs[block.msgs.length - 1];
          const hasError = lastMsg.role === "assistant" && lastMsg.isError;
          const isLastBlock = blockIdx === messageBlocks.length - 1;
          const showFeedback = !hasError && !(isLastBlock && loading);

          return [
            <AIAnalystLabel key={`ai-label-${blockIdx}`} />,
            ...renderedMsgs,
            ...(showFeedback
              ? [
                  <AIChatFeedback
                    key={`feedback-${lastMsg.id}`}
                    messageId={lastMsg.id}
                    conversationId={conversationId}
                    value={
                      feedbackMap[lastMsg.id] ?? {
                        rating: null,
                        comment: "",
                      }
                    }
                    onSubmit={onFeedbackSubmit}
                  />,
                ]
              : []),
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
  );
}
