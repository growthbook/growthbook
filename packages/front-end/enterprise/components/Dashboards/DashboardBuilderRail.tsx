import { Box, Flex, IconButton } from "@radix-ui/themes";
import { KeyboardEvent, RefObject } from "react";
import clsx from "clsx";
import { BsStars } from "react-icons/bs";
import {
  PiArrowsClockwise,
  PiArrowUp,
  PiChartBar,
  PiChatText,
  PiCheckCircleFill,
  PiCircle,
  PiPencilSimple,
  PiPlusSquare,
  PiStop,
  PiWarningCircleFill,
  PiX,
} from "react-icons/pi";
import type { AIChatMessage } from "shared/ai-chat";
import { getMessageText } from "shared/ai-chat";
import Markdown from "@/components/Markdown/Markdown";
import Badge from "@/ui/Badge";
import SegmentedControl from "@/ui/SegmentedControl";
import Text from "@/ui/Text";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat";
import useBottomBarClearance from "@/hooks/useBottomBarClearance";
import {
  builderChanges,
  builderSteps,
  BuilderStep,
  BuilderToolCall,
  isBuilderWriteTool,
  toolCallsFromMessages,
} from "./dashboardBuilderSteps";
import styles from "./DashboardBuilder.module.scss";

export type BuilderMode = "build" | "ask";

type Turn =
  | { kind: "user"; id: string; text: string }
  | { kind: "ai"; id: string; calls: BuilderToolCall[]; texts: string[] };

function toTurns(messages: AIChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let block: AIChatMessage[] = [];
  const flush = () => {
    if (!block.length) return;
    turns.push({
      kind: "ai",
      id: block[0].id,
      calls: toolCallsFromMessages(block),
      texts: block.flatMap((m) =>
        m.role === "assistant" && getMessageText(m).trim()
          ? [getMessageText(m)]
          : [],
      ),
    });
    block = [];
  };
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      flush();
      turns.push({ kind: "user", id: msg.id, text: getMessageText(msg) });
    } else {
      block.push(msg);
    }
  }
  flush();
  return turns;
}

function StepIcon({ state }: { state: BuilderStep["state"] }) {
  if (state === "running") {
    return (
      <PiArrowsClockwise className={styles.spin} color="var(--violet-11)" />
    );
  }
  if (state === "done") return <PiCheckCircleFill color="var(--green-9)" />;
  if (state === "error") return <PiWarningCircleFill color="var(--red-9)" />;
  return <PiCircle color="var(--slate-8)" />;
}

function AiMessage({
  calls,
  texts,
}: {
  calls: BuilderToolCall[];
  texts: string[];
}) {
  const steps = builderSteps(calls);
  const changes = builderChanges(calls);
  const editing = calls.some((c) => isBuilderWriteTool(c.toolName));
  return (
    <Flex
      direction="column"
      gap="2"
      className={clsx(styles.aiMessage, !editing && styles.answer)}
    >
      <Flex align="center" gap="2">
        <Text size="sm" weight="semibold">
          AI Assistant
        </Text>
        <Badge
          size="xs"
          variant="soft"
          color={editing ? "violet" : "blue"}
          label={
            <Flex align="center" gap="1">
              {editing ? <PiPencilSimple /> : <PiChatText />}
              {editing ? "Editing dashboard" : "Answer"}
            </Flex>
          }
        />
      </Flex>
      {steps.length > 0 ? (
        <Flex direction="column" gap="1" p="2" className={styles.card}>
          {steps.map((step) => (
            <Flex key={step.key} align="start" gap="2">
              <Flex align="center" height="var(--line-height-1)" flexShrink="0">
                <StepIcon state={step.state} />
              </Flex>
              <Text
                size="sm"
                color={step.state === "pending" ? "text-low" : undefined}
              >
                <span className={styles.stepLabel}>{step.label}</span>{" "}
                <Text size="sm" color="text-low">
                  {step.detail}
                </Text>
              </Text>
            </Flex>
          ))}
        </Flex>
      ) : null}
      {texts.map((text, i) => (
        <Markdown key={i}>{text}</Markdown>
      ))}
      {changes.length > 0 ? (
        <Flex direction="column" gap="1" p="2" className={styles.card}>
          <Text size="sm" weight="semibold" color="text-low">
            Changes to dashboard
          </Text>
          {changes.map((change) => (
            <Flex key={change} align="center" gap="2">
              <PiPlusSquare color="var(--slate-10)" />
              <Text size="sm">{change}</Text>
            </Flex>
          ))}
        </Flex>
      ) : null}
    </Flex>
  );
}

// The design's input: a plain two-row box with one send button.
function Composer({
  value,
  onChange,
  onSend,
  onCancel,
  loading,
  isLocalStream,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
  placeholder: string;
}) {
  const canSend = value.trim().length > 0 && !loading;
  const send = () => {
    if (canSend) onSend(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };
  return (
    <div className={styles.composerBox}>
      <textarea
        className={styles.composerInput}
        aria-label="Message the AI Assistant"
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {isLocalStream ? (
        <button
          type="button"
          className={styles.sendButton}
          aria-label="Stop"
          title="Stop"
          onClick={onCancel}
        >
          <PiStop size={15} />
        </button>
      ) : (
        <button
          type="button"
          className={styles.sendButton}
          aria-label="Send"
          title="Send"
          disabled={!canSend}
          onClick={send}
        >
          <PiArrowUp size={15} />
        </button>
      )}
    </div>
  );
}

export default function DashboardBuilderRail({
  dashboardTitle,
  datasourceName,
  messages,
  activeTurnItems,
  displayedTextMap,
  loading,
  isLocalStream,
  error,
  mode,
  setMode,
  input,
  setInput,
  onSend,
  onCancel,
  onClose,
  scrollContainerRef,
  messagesEndRef,
  onScroll,
}: {
  dashboardTitle: string;
  datasourceName: string;
  messages: AIChatMessage[];
  activeTurnItems: ActiveTurnItem[];
  displayedTextMap: Map<string, string>;
  loading: boolean;
  isLocalStream: boolean;
  error: string | null;
  mode: BuilderMode;
  setMode: (mode: BuilderMode) => void;
  input: string;
  setInput: (value: string) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
  onClose: () => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
  messagesEndRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
}) {
  // Lifts the app's floating help button clear of the input.
  const footerRef = useBottomBarClearance<HTMLDivElement>();
  const turns = toTurns(messages);
  const activeCalls: BuilderToolCall[] = activeTurnItems.flatMap((item) =>
    item.kind === "tool-status"
      ? [
          {
            id: item.toolCallId,
            toolName: item.toolName,
            args: item.toolInput,
            status: item.status,
          },
        ]
      : [],
  );
  const activeTexts = activeTurnItems.flatMap((item) =>
    item.kind === "text" ? [displayedTextMap.get(item.id) ?? item.content] : [],
  );
  const hasActive = activeCalls.length > 0 || activeTexts.length > 0;

  return (
    <div className={styles.rail}>
      <Flex align="center" gap="2" px="3" py="3" className={styles.railHeader}>
        <span className={styles.iconCircle}>
          <BsStars />
        </span>
        <Box flexGrow="1">
          <Text weight="semibold">AI Assistant</Text>
        </Box>
        <IconButton
          variant="ghost"
          color="violet"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          mr="1"
        >
          <PiX />
        </IconButton>
      </Flex>

      <div
        className={styles.messages}
        ref={scrollContainerRef}
        onScroll={onScroll}
      >
        {/* Bottom room so the last message scrolls clear of the lifted help button. */}
        <Flex direction="column" gap="4" p="4" pb="9">
          {turns.length === 0 && !hasActive && !loading ? (
            <Flex direction="column" gap="2" p="3" className={styles.card}>
              <Text weight="semibold">Hey there! 👋</Text>
              <Text size="md" color="text-low">
                I can see your metrics and fact tables
                {datasourceName ? ` in ${datasourceName}` : ""}. Ask about this
                dashboard, or tell me what to change.
              </Text>
            </Flex>
          ) : null}
          {turns.map((turn) =>
            turn.kind === "user" ? (
              <div key={turn.id} className={styles.userBubble}>
                <Text size="md">{turn.text}</Text>
              </div>
            ) : (
              <AiMessage key={turn.id} calls={turn.calls} texts={turn.texts} />
            ),
          )}
          {hasActive ? (
            <AiMessage calls={activeCalls} texts={activeTexts} />
          ) : null}
          {loading && !hasActive ? (
            <Flex align="center" gap="2">
              <BsStars className={styles.pulse} color="var(--violet-11)" />
              <Text size="sm" color="text-low">
                Thinking…
              </Text>
            </Flex>
          ) : null}
          {error ? (
            <Text size="md" color="text-low">
              {error}
            </Text>
          ) : null}
          <div ref={messagesEndRef} />
        </Flex>
      </div>

      <Flex
        ref={footerRef}
        direction="column"
        gap="2"
        p="3"
        className={styles.railFooter}
      >
        <Flex align="center" justify="between" gap="2">
          <SegmentedControl
            aria-label="Mode"
            size="sm"
            value={mode}
            setValue={setMode}
            options={[
              {
                value: "build",
                label: (
                  <Flex align="center" gap="1">
                    <PiPencilSimple />
                    Edit
                  </Flex>
                ),
              },
              {
                value: "ask",
                label: (
                  <Flex align="center" gap="1">
                    <PiChatText />
                    Ask
                  </Flex>
                ),
              },
            ]}
          />
          <Badge
            size="sm"
            variant="soft"
            color="gray"
            style={{ maxWidth: "50%", overflow: "hidden" }}
            label={
              <Flex align="center" gap="1" minWidth="0">
                <PiChartBar style={{ flexShrink: 0 }} />
                <Text size="sm" truncate>
                  {dashboardTitle}
                </Text>
              </Flex>
            }
          />
        </Flex>
        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onCancel={onCancel}
          loading={loading}
          isLocalStream={isLocalStream}
          placeholder={
            mode === "build"
              ? "Describe a change to the dashboard…"
              : "Ask about your data…"
          }
        />
        <Text color="text-low" size="sm">
          {mode === "build"
            ? "Edit changes the draft. Viewers see nothing until you publish."
            : "Ask answers questions and never changes the dashboard."}
        </Text>
      </Flex>
    </div>
  );
}
