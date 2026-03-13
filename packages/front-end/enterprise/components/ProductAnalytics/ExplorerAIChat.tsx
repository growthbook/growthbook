import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Flex, Box } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { PiPaperPlaneRight, PiSparkle } from "react-icons/pi";
import {
  ProductAnalyticsResultRow,
  ExplorationConfig,
  ProductAnalyticsExploration,
  explorationConfigValidator,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import OptInModal from "@/components/License/OptInModal";
import Markdown from "@/components/Markdown/Markdown";
import { useExplorerContext } from "./ExplorerContext";
import ExplorerChart from "./MainSection/ExplorerChart";
import styles from "./ExplorerAIChat.module.scss";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "text" | "chart";
  snapshotId?: string;
}

interface Snapshot {
  id: string;
  timestamp: string;
  summary: string;
  config: string;
  resultData: string | null;
  configObj: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
}

const MAX_RESULT_ROWS = 200;
const MAX_SNAPSHOTS = 15;
const CONFIG_BLOCK_REGEX = /```exploration-config\s*([\s\S]*?)```/i;
const MAX_VALIDATION_ISSUES_SHOWN = 3;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithBaseConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = merged[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      merged[key] = mergeWithBaseConfig(baseValue, patchValue);
    } else {
      merged[key] = patchValue;
    }
  }
  return merged;
}

function normalizeDateRangeAliases(config: unknown): unknown {
  if (!isPlainObject(config)) return config;
  const nextConfig: Record<string, unknown> = { ...config };
  const dateRange = nextConfig.dateRange;
  if (!isPlainObject(dateRange)) {
    return nextConfig;
  }

  const nextDateRange: Record<string, unknown> = { ...dateRange };
  const predefinedRaw =
    typeof nextDateRange.predefined === "string" ? nextDateRange.predefined : "";
  const normalized = predefinedRaw.toLowerCase();

  if (["last14days", "last_14_days", "14days", "14d"].includes(normalized)) {
    nextDateRange.predefined = "customLookback";
    if (
      nextDateRange.lookbackValue == null ||
      typeof nextDateRange.lookbackValue !== "number"
    ) {
      nextDateRange.lookbackValue = 14;
    }
    if (
      nextDateRange.lookbackUnit == null ||
      typeof nextDateRange.lookbackUnit !== "string"
    ) {
      nextDateRange.lookbackUnit = "day";
    }
  }

  nextConfig.dateRange = nextDateRange;
  return nextConfig;
}

function formatValidationErrors(
  issues: { path: PropertyKey[]; message: string }[],
) {
  return issues
    .slice(0, MAX_VALIDATION_ISSUES_SHOWN)
    .map((i) => {
      const keyPath = i.path.map((p) => String(p)).join(".");
      return `${keyPath || "root"}: ${i.message}`;
    })
    .join("; ");
}

function buildResultCsv(
  rows: ProductAnalyticsResultRow[],
  config: ExplorationConfig | null,
): string | null {
  if (!rows.length || !config) return null;

  const dimHeaders: string[] = (config.dimensions ?? []).map((d) => {
    if (d.dimensionType === "date") return "Date";
    if (d.dimensionType === "dynamic") return d.column ?? "Dimension";
    if (d.dimensionType === "static") return d.column;
    if (d.dimensionType === "slice") return "Slice";
    return "Dimension";
  });
  if (!dimHeaders.length) dimHeaders.push("Total");

  const valueNames = config.dataset?.values?.map((v) => v.name) ?? [];
  const hasDenom = valueNames.map((_, i) =>
    rows.some((r) => r.values[i]?.denominator != null),
  );

  const metricHeaders: string[] = [];
  for (let i = 0; i < valueNames.length; i++) {
    if (hasDenom[i]) {
      metricHeaders.push(
        `${valueNames[i]} Numerator`,
        `${valueNames[i]} Denominator`,
        `${valueNames[i]} Value`,
      );
    } else {
      metricHeaders.push(valueNames[i]);
    }
  }

  const header = [...dimHeaders, ...metricHeaders].join(",");

  const truncated = rows.slice(0, MAX_RESULT_ROWS);
  const dataLines = truncated.map((row) => {
    const dimCells =
      dimHeaders.length === 1 && dimHeaders[0] === "Total"
        ? ["Total"]
        : row.dimensions.map((d) => d ?? "");

    const metricCells: string[] = [];
    for (let i = 0; i < valueNames.length; i++) {
      const v = row.values[i];
      if (hasDenom[i]) {
        metricCells.push(
          v?.numerator != null ? String(v.numerator) : "",
          v?.denominator != null ? String(v.denominator) : "",
          v?.numerator != null && v?.denominator != null
            ? (v.numerator / v.denominator).toFixed(4)
            : "",
        );
      } else {
        const val =
          v?.numerator != null
            ? v.denominator
              ? (v.numerator / v.denominator).toFixed(4)
              : String(v.numerator)
            : "";
        metricCells.push(val);
      }
    }

    return [...dimCells, ...metricCells]
      .map((c) => (c.includes(",") ? `"${c}"` : c))
      .join(",");
  });

  let csv = [header, ...dataLines].join("\n");
  if (rows.length > MAX_RESULT_ROWS) {
    csv += `\n... (${rows.length - MAX_RESULT_ROWS} more rows truncated)`;
  }
  return csv;
}

function buildSnapshotSummary(
  prev: ExplorationConfig | null,
  curr: ExplorationConfig,
): string {
  const parts: string[] = [];

  if (!prev) {
    parts.push(
      `Initial: ${curr.chartType} chart, ${curr.type} dataset, date range ${curr.dateRange.predefined}`,
    );
    const valueNames = curr.dataset?.values?.map((v) => v.name).filter(Boolean);
    if (valueNames?.length) {
      parts.push(`values: ${valueNames.join(", ")}`);
    }
    return parts.join(", ");
  }

  if (prev.chartType !== curr.chartType) {
    parts.push(`chart type: ${prev.chartType} → ${curr.chartType}`);
  }
  if (prev.dateRange.predefined !== curr.dateRange.predefined) {
    parts.push(
      `date range: ${prev.dateRange.predefined} → ${curr.dateRange.predefined}`,
    );
  }

  const prevNames = prev.dataset?.values?.map((v) => v.name) ?? [];
  const currNames = curr.dataset?.values?.map((v) => v.name) ?? [];
  const added = currNames.filter((n) => !prevNames.includes(n));
  const removed = prevNames.filter((n) => !currNames.includes(n));
  if (added.length) parts.push(`added: ${added.join(", ")}`);
  if (removed.length) parts.push(`removed: ${removed.join(", ")}`);

  const prevDims = prev.dimensions?.length ?? 0;
  const currDims = curr.dimensions?.length ?? 0;
  if (prevDims !== currDims) {
    parts.push(`dimensions: ${prevDims} → ${currDims}`);
  }

  if (prev.datasource !== curr.datasource) {
    parts.push("datasource changed");
  }

  return parts.length ? parts.join(", ") : "minor config update";
}

export default function ExplorerAIChat() {
  const messageCounterRef = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplyingConfig, setIsApplyingConfig] = useState(false);
  const [showAIAgreement, setShowAIAgreement] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const snapshotsRef = useRef<Snapshot[]>([]);
  const prevConfigRef = useRef<ExplorationConfig | null>(null);
  const prevSnapshotFingerprintRef = useRef<string | null>(null);
  const pendingChartSnapshotRef = useRef(false);
  const snapshotCounterRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingChartTimeoutRef = useRef<number | null>(null);

  const { fetchRaw } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const {
    draftExploreState,
    exploration,
    submittedExploreState,
    handleSubmit,
  } = useExplorerContext();

  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  const resultCsv = useMemo(
    () =>
      buildResultCsv(exploration?.result?.rows ?? [], submittedExploreState),
    [exploration?.result?.rows, submittedExploreState],
  );

  // Track snapshots when submitted config changes
  useEffect(() => {
    if (!submittedExploreState) return;

    const configJson = JSON.stringify(submittedExploreState);
    const snapshotFingerprint = `${configJson}::${resultCsv ?? ""}`;
    if (snapshotFingerprint === prevSnapshotFingerprintRef.current) return;

    const summary = buildSnapshotSummary(
      prevConfigRef.current,
      submittedExploreState,
    );

    snapshotCounterRef.current += 1;
    const snap: Snapshot = {
      id: `snap_${snapshotCounterRef.current}`,
      timestamp: new Date().toLocaleTimeString(),
      summary,
      config: configJson,
      resultData: resultCsv,
      configObj: submittedExploreState,
      exploration: exploration ?? null,
    };

    snapshotsRef.current = [
      ...snapshotsRef.current.slice(-MAX_SNAPSHOTS + 1),
      snap,
    ];

    prevConfigRef.current = submittedExploreState;
    prevSnapshotFingerprintRef.current = snapshotFingerprint;

    if (pendingChartSnapshotRef.current) {
      if (pendingChartTimeoutRef.current != null) {
        window.clearTimeout(pendingChartTimeoutRef.current);
        pendingChartTimeoutRef.current = null;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${messageCounterRef.current++}`,
          role: "assistant",
          content: "",
          kind: "chart",
          snapshotId: snap.id,
        },
      ]);
      pendingChartSnapshotRef.current = false;
      setIsApplyingConfig(false);
    }
  }, [submittedExploreState, resultCsv, exploration]);

  useEffect(() => {
    return () => {
      if (pendingChartTimeoutRef.current != null) {
        window.clearTimeout(pendingChartTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const applyConfigFromAssistant = useCallback(
    async (assistantMessage: string) => {
      setApplyError(null);
      const match = assistantMessage.match(CONFIG_BLOCK_REGEX);
      if (!match?.[1]) {
        return assistantMessage;
      }

      const jsonText = match[1].trim().replace(/^json\s*/i, "");
      try {
        const parsedUnknown = normalizeDateRangeAliases(JSON.parse(jsonText));
        const validation = explorationConfigValidator.safeParse(parsedUnknown);
        if (!validation.success) {
          if (!isPlainObject(parsedUnknown)) {
            const details = formatValidationErrors(validation.error.issues);
            setApplyError(
              `AI config was invalid. ${details || "Please ask it to try again."}`,
            );
            return assistantMessage.replace(CONFIG_BLOCK_REGEX, "").trim();
          }

          const mergedCandidate = mergeWithBaseConfig(
            draftExploreState as unknown as Record<string, unknown>,
            parsedUnknown,
          );
          const mergedValidation =
            explorationConfigValidator.safeParse(mergedCandidate);
          if (mergedValidation.success) {
            setIsApplyingConfig(true);
            pendingChartSnapshotRef.current = true;
            await handleSubmit({
              force: true,
              config: mergedValidation.data,
              setDraft: true,
            });
            if (pendingChartTimeoutRef.current != null) {
              window.clearTimeout(pendingChartTimeoutRef.current);
            }
            pendingChartTimeoutRef.current = window.setTimeout(() => {
              if (!pendingChartSnapshotRef.current) return;
              pendingChartSnapshotRef.current = false;
              setIsApplyingConfig(false);
              setApplyError(
                "Config was applied, but chart rendering is delayed. Try asking to rerun.",
              );
            }, 10000);
            return assistantMessage.replace(CONFIG_BLOCK_REGEX, "").trim();
          }

          const details = formatValidationErrors(mergedValidation.error.issues);
          console.error(
            "Invalid AI exploration config",
            mergedValidation.error.issues,
            jsonText,
          );
          setApplyError(
            `AI config was invalid. ${details || "Please ask it to try again."}`,
          );
          return assistantMessage.replace(CONFIG_BLOCK_REGEX, "").trim();
        }

        setIsApplyingConfig(true);
        pendingChartSnapshotRef.current = true;
        await handleSubmit({
          force: true,
          config: validation.data,
          setDraft: true,
        });
        if (pendingChartTimeoutRef.current != null) {
          window.clearTimeout(pendingChartTimeoutRef.current);
        }
        pendingChartTimeoutRef.current = window.setTimeout(() => {
          if (!pendingChartSnapshotRef.current) return;
          pendingChartSnapshotRef.current = false;
          setIsApplyingConfig(false);
          setApplyError(
            "Config was applied, but chart rendering is delayed. Try asking to rerun.",
          );
        }, 10000);
      } catch (err) {
        console.error("Failed to parse AI config JSON", err, jsonText);
        pendingChartSnapshotRef.current = false;
        setApplyError(
          "AI config could not be parsed as JSON. Ask it to return strict JSON only.",
        );
        setIsApplyingConfig(false);
      } finally {
        if (!pendingChartSnapshotRef.current) {
          setIsApplyingConfig(false);
        }
      }

      return assistantMessage.replace(CONFIG_BLOCK_REGEX, "").trim();
    },
    [handleSubmit, draftExploreState],
  );

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = {
      id: `msg_${messageCounterRef.current++}`,
      role: "user",
      content: trimmed,
      kind: "text",
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setError(null);
    setLoading(true);
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetchRaw("/product-analytics/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-no-compression": "1",
        },
        body: JSON.stringify({
          messages: newMessages
            .filter((m) => m.kind !== "chart")
            .map((m) => ({ role: m.role, content: m.content })),
          datasourceId: draftExploreState.datasource,
          currentConfig: draftExploreState,
          ...(resultCsv ? { resultData: resultCsv } : {}),
          ...(snapshotsRef.current.length
            ? {
                snapshots: snapshotsRef.current.map((s) => ({
                  id: s.id,
                  timestamp: s.timestamp,
                  summary: s.summary,
                  config: s.config,
                  resultData: s.resultData,
                })),
              }
            : {}),
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
          setError(
            errorData?.message || `Error: ${response.status}`,
          );
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
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamingText(fullText);
      }

      setStreamingText("");
      const strippedAssistantText = fullText.replace(CONFIG_BLOCK_REGEX, "").trim();
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${messageCounterRef.current++}`,
          role: "assistant",
          kind: "text",
          content:
            strippedAssistantText || "Applied your requested configuration update.",
        },
      ]);
      await applyConfigFromAssistant(fullText);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled, ignore
      } else {
        setError("Failed to get a response. Please try again.");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [
    input,
    loading,
    messages,
    fetchRaw,
    draftExploreState,
    resultCsv,
    applyConfigFromAssistant,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

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

  return (
    <>
      {showAIAgreement && (
        <OptInModal
          agreement="ai"
          onClose={() => setShowAIAgreement(false)}
        />
      )}
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
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              abortControllerRef.current?.abort();
              setMessages([]);
              setStreamingText("");
              setError(null);
              setApplyError(null);
              pendingChartSnapshotRef.current = false;
            }}
          >
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
          {messages.length === 0 && !streamingText && (
            <Flex
              align="center"
              justify="center"
              direction="column"
              gap="2"
              py="6"
            >
              <BsStars size={24} color="var(--gray-a8)" />
              <Text size="small" color="text-low" align="center">
                Ask about your data, and I&apos;ll answer with analysis plus charts
                inline.
              </Text>
            </Flex>
          )}

          {messages.map((msg) => {
            if (msg.kind === "chart" && msg.snapshotId) {
              const snapshot = snapshotsRef.current.find(
                (s) => s.id === msg.snapshotId,
              );
              if (!snapshot || !snapshot.configObj) {
                return (
                  <Box key={msg.id} className={styles.assistantMessage}>
                    <Text size="small" color="text-low">
                      Chart snapshot unavailable.
                    </Text>
                  </Box>
                );
              }
              return (
                <Box key={msg.id} className={styles.chartMessage}>
                  <Flex align="center" gap="2" mb="2">
                    <PiSparkle size={12} />
                    <Text size="small" weight="medium">
                      Generated chart ({snapshot.timestamp})
                    </Text>
                  </Flex>
                  <Box className={styles.chartMessageInner}>
                    <ExplorerChart
                      exploration={snapshot.exploration}
                      error={null}
                      submittedExploreState={snapshot.configObj}
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
          })}

          {streamingText && (
            <Box className={styles.assistantMessage}>
              <Markdown>{streamingText}</Markdown>
            </Box>
          )}
          {loading && !streamingText && (
            <Box className={styles.assistantMessage}>
              <Text size="small" color="text-low">
                Thinking...
              </Text>
            </Box>
          )}
          {isApplyingConfig && !loading && !streamingText && (
            <Box className={styles.assistantMessage}>
              <Text size="small" color="text-low">
                Applying chart configuration...
              </Text>
            </Box>
          )}
          {error && (
            <Box className={styles.errorMessage}>
              <Text size="small">{error}</Text>
            </Box>
          )}
          {applyError && (
            <Box className={styles.errorMessage}>
              <Text size="small">{applyError}</Text>
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
            disabled={loading || isApplyingConfig}
          />
          <button
            className={styles.sendButton}
            onClick={sendMessage}
            disabled={!input.trim() || loading || isApplyingConfig}
          >
            <PiPaperPlaneRight size={16} />
          </button>
        </Flex>
      </Flex>
    </>
  );
}
