import React, { useState, useRef, useEffect, useCallback } from "react";
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
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Markdown from "@/components/Markdown/Markdown";
import { useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";
import styles from "./ExplorerAIChat.module.scss";

const TOOL_STATUS_LABELS: Record<string, string> = {
  runExploration: "Running query...",
  getSnapshot: "Inspecting data...",
  searchMetrics: "Searching metrics...",
  getCurrentConfig: "Reading current config...",
  getConfigSchema: "Loading config schema...",
};

// Typewriter: how many characters to reveal per tick and how often to tick.
// At 30 ms × 3 chars = ~100 chars/sec — smooths out burst arrivals while
// keeping the reveal pace comfortable to read.
const TYPEWRITER_INTERVAL_MS = 30;
const TYPEWRITER_CHARS_PER_TICK = 3;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "text" | "chart" | "tool-call";
  snapshotId?: string;
  toolLabel?: string;
}

// Represents one item in the current streaming turn, rendered in order.
type ActiveTurnItem =
  | { kind: "text"; id: string; content: string }
  | { kind: "chart"; id: string; snapshotId: string }
  | {
      kind: "tool-status";
      id: string;
      toolCallId: string;
      label: string;
      status: "running" | "done";
    }
  | { kind: "thinking"; id: string };

interface ChartData {
  config: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
}

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

function parseSSEEvents(buffer: string): {
  parsed: SSEEvent[];
  remaining: string;
} {
  const parsed: SSEEvent[] = [];
  const blocks = buffer.split("\n\n");
  // Last block may be incomplete
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    const lines = block.split("\n");
    let eventType = "message";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice("event: ".length).trim();
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice("data: ".length).trim();
      }
    }

    if (dataStr) {
      try {
        const data = JSON.parse(dataStr) as Record<string, unknown>;
        parsed.push({ type: eventType, data });
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  return { parsed, remaining };
}

export default function ExplorerAIChat() {
  const messageCounterRef = useRef(0);
  const sessionIdRef = useRef(crypto.randomUUID());

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTurnItems, setActiveTurnItems] = useState<ActiveTurnItem[]>([]);
  // Ref mirrors state so we can read the latest value inside async SSE loops
  const activeTurnItemsRef = useRef<ActiveTurnItem[]>([]);

  // Typewriter: tracks how much of each text item's content has been revealed.
  // Keyed by the text item's id. The interval below drains this toward the
  // full content stored in activeTurnItemsRef.
  const [displayedTextMap, setDisplayedTextMap] = useState<Map<string, string>>(
    new Map(),
  );
  const displayedTextMapRef = useRef<Map<string, string>>(new Map());

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // True while a tool just finished and we're waiting for the next step's first token
  const [waitingForNextStep, setWaitingForNextStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chartDataRef = useRef<Map<string, ChartData>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  const { fetchRaw } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { aiEnabled } = useAISettings();
  const { draftExploreState } = useExplorerContext();

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTurnItems]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Helper: update activeTurnItems both in state (triggers re-render) and ref (readable in closures).
  // When clearing (items === []), also reset the typewriter map so stale entries don't linger.
  const setActive = (items: ActiveTurnItem[]) => {
    if (items.length === 0) {
      displayedTextMapRef.current = new Map();
      setDisplayedTextMap(new Map());
    }
    activeTurnItemsRef.current = items;
    setActiveTurnItems(items);
  };

  // Typewriter interval: continuously drains the gap between each text item's
  // full received content and what has been visually revealed so far.
  // Runs for the lifetime of the component — it is a no-op when there is
  // nothing left to reveal, so the cost is negligible.
  useEffect(() => {
    const interval = setInterval(() => {
      const items = activeTurnItemsRef.current;
      const current = displayedTextMapRef.current;
      let changed = false;

      const next = new Map(current);
      for (const item of items) {
        if (item.kind !== "text") continue;
        const revealed = current.get(item.id) ?? "";
        if (revealed.length < item.content.length) {
          changed = true;
          const nextLen = Math.min(
            revealed.length + TYPEWRITER_CHARS_PER_TICK,
            item.content.length,
          );
          next.set(item.id, item.content.slice(0, nextLen));
        }
      }

      if (changed) {
        displayedTextMapRef.current = next;
        setDisplayedTextMap(new Map(next));
      }
    }, TYPEWRITER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      id: `msg_${messageCounterRef.current++}`,
      role: "user",
      content: trimmed,
      kind: "text",
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setLoading(true);
    setActive([]);
    setWaitingForNextStep(false);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Converts the current activeTurnItems into finalized ChatMessages and
    // appends them to the messages array, then clears the active items.
    const finalizeTurn = () => {
      const items = activeTurnItemsRef.current;
      if (!items.length) return;

      const newMessages: ChatMessage[] = [];
      for (const item of items) {
        if (item.kind === "thinking") {
          // Ephemeral — not persisted to message history
          continue;
        } else if (item.kind === "text" && item.content.trim()) {
          newMessages.push({
            id: `msg_${messageCounterRef.current++}`,
            role: "assistant",
            kind: "text",
            content: item.content,
          });
        } else if (item.kind === "chart") {
          newMessages.push({
            id: `msg_${messageCounterRef.current++}`,
            role: "assistant",
            kind: "chart",
            snapshotId: item.snapshotId,
            content: "",
          });
        } else if (item.kind === "tool-status") {
          // Persist completed tool calls so they remain visible in subsequent turns
          newMessages.push({
            id: `msg_${messageCounterRef.current++}`,
            role: "assistant",
            kind: "tool-call",
            content: "",
            toolLabel: item.label,
          });
        }
      }

      if (newMessages.length) {
        setMessages((prev) => [...prev, ...newMessages]);
      }
      setActive([]);
    };

    try {
      const response = await fetchRaw("/product-analytics/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-no-compression": "1",
        },
        body: JSON.stringify({
          message: trimmed,
          sessionId: sessionIdRef.current,
          datasourceId: draftExploreState.datasource,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        if (response.status === 429 && errorData?.retryAfter) {
          const retryAfter = parseInt(errorData.retryAfter);
          const hours = Math.floor(retryAfter / 3600);
          const minutes = Math.floor((retryAfter % 3600) / 60);
          setError(
            `AI request limit reached. Try again in ${hours}h ${minutes}m.`,
          );
        } else {
          setError(errorData?.message || `Error: ${response.status}`);
        }
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError("Streaming not supported");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { parsed, remaining } = parseSSEEvents(buffer);
        buffer = remaining;

        for (const event of parsed) {
          const current = activeTurnItemsRef.current;

          switch (event.type) {
            case "reasoning-delta": {
              // Reasoning tokens arrive before new text — show a thinking indicator.
              // Also clear the "waiting for next step" spinner since tokens are flowing.
              setWaitingForNextStep(false);
              const last = current[current.length - 1];
              if (last?.kind !== "thinking") {
                setActive([
                  ...current,
                  {
                    kind: "thinking",
                    id: `thinking_${messageCounterRef.current++}`,
                  },
                ]);
              }
              break;
            }
            case "text-delta": {
              const content = event.data.content;
              if (typeof content === "string") {
                setWaitingForNextStep(false);
                // Remove any trailing thinking indicator once real text arrives
                const withoutThinking =
                  current[current.length - 1]?.kind === "thinking"
                    ? current.slice(0, -1)
                    : current;
                const last = withoutThinking[withoutThinking.length - 1];
                if (last?.kind === "text") {
                  setActive([
                    ...withoutThinking.slice(0, -1),
                    { ...last, content: last.content + content },
                  ]);
                } else {
                  setActive([
                    ...withoutThinking,
                    {
                      kind: "text",
                      id: `text_${messageCounterRef.current++}`,
                      content,
                    },
                  ]);
                }
              }
              break;
            }
            case "tool-call-start": {
              const toolName =
                typeof event.data.toolName === "string"
                  ? event.data.toolName
                  : "";
              const toolCallId =
                typeof event.data.toolCallId === "string"
                  ? event.data.toolCallId
                  : `tool_${messageCounterRef.current++}`;
              const label = TOOL_STATUS_LABELS[toolName] ?? "Working...";
              setWaitingForNextStep(false);
              setActive([
                ...current,
                {
                  kind: "tool-status",
                  id: toolCallId,
                  toolCallId,
                  label,
                  status: "running",
                },
              ]);
              break;
            }
            case "tool-call-end": {
              const toolCallId =
                typeof event.data.toolCallId === "string"
                  ? event.data.toolCallId
                  : "";
              // Mark done (keep visible with checkmark) instead of removing,
              // and signal that we're waiting for the model's next step.
              setWaitingForNextStep(true);
              setActive(
                current.map((item) =>
                  item.kind === "tool-status" && item.toolCallId === toolCallId
                    ? { ...item, status: "done" as const }
                    : item,
                ),
              );
              break;
            }
            case "chart-result": {
              const snapshotId = event.data.snapshotId;
              const toolCallId =
                typeof event.data.toolCallId === "string"
                  ? event.data.toolCallId
                  : null;

              if (typeof snapshotId === "string") {
                chartDataRef.current.set(snapshotId, {
                  config: event.data.config as ExplorationConfig,
                  exploration:
                    (event.data.exploration as ProductAnalyticsExploration) ??
                    null,
                });

                const chartItem: ActiveTurnItem = {
                  kind: "chart",
                  id: snapshotId,
                  snapshotId,
                };

                // Mark the matching tool-status as done, then insert chart after it.
                // Also enter "waiting for next step" since a chart counts as a tool completion.
                setWaitingForNextStep(true);
                let insertIdx = -1;
                const marked = current.map((item, idx) => {
                  if (
                    insertIdx === -1 &&
                    item.kind === "tool-status" &&
                    (toolCallId === null || item.toolCallId === toolCallId)
                  ) {
                    insertIdx = idx;
                    return { ...item, status: "done" as const };
                  }
                  return item;
                });
                if (insertIdx !== -1) {
                  marked.splice(insertIdx + 1, 0, chartItem);
                  setActive(marked);
                } else {
                  setActive([...current, chartItem]);
                }
              }
              break;
            }
            case "error": {
              const msg = event.data.message;
              setError(typeof msg === "string" ? msg : "An error occurred");
              break;
            }
            case "done": {
              setWaitingForNextStep(false);
              finalizeTurn();
              break;
            }
            default:
              break;
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled, ignore
      } else {
        setError("Failed to get a response. Please try again.");
      }
    } finally {
      finalizeTurn();
      setWaitingForNextStep(false);
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, loading, fetchRaw, draftExploreState]);

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
    abortControllerRef.current?.abort();
    sessionIdRef.current = crypto.randomUUID();
    chartDataRef.current = new Map();
    setMessages([]);
    setActive([]);
    setError(null);
  }, []);

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
    if (item.kind === "chart") {
      const chartData = chartDataRef.current.get(item.snapshotId);
      if (!chartData) return null;
      return (
        <Box key={item.id} className={styles.chartMessage}>
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
    <>
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
              AI Chat
            </Heading>
          </Flex>
          <Button variant="ghost" size="xs" onClick={handleNewChat}>
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
                Ask about your data, and I&apos;ll answer with analysis plus
                charts inline.
              </Text>
            </Flex>
          )}

          {/* Render finalized messages and active turn items in a single
              flat array so React reconciles keys across both — this prevents
              charts from unmounting/remounting (and re-animating) when
              finalizeTurn moves them from activeTurnItems into messages. */}
          {[
            ...messages.map((msg) => {
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

              if (msg.kind === "chart" && msg.snapshotId) {
                const chartData = chartDataRef.current.get(msg.snapshotId);
                if (!chartData) {
                  return (
                    <Box key={msg.id} className={styles.assistantMessage}>
                      <Text size="small" color="text-low">
                        Chart data unavailable.
                      </Text>
                    </Box>
                  );
                }
                return (
                  <Box key={msg.snapshotId} className={styles.chartMessage}>
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

              return (
                <Box
                  key={msg.id}
                  className={
                    msg.role === "user"
                      ? styles.userMessage
                      : styles.assistantMessage
                  }
                >
                  {msg.role === "assistant" ? (
                    <Markdown>{msg.content}</Markdown>
                  ) : (
                    <Text size="small">{msg.content}</Text>
                  )}
                </Box>
              );
            }),
            ...activeTurnItems.map(renderActiveTurnItem),
          ]}

          {/* Initial thinking indicator before any events arrive */}
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

          {/* Inter-step indicator: tool just finished, waiting for the model's next move */}
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
    </>
  );
}
