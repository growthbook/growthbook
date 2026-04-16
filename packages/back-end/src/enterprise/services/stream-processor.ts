import { randomUUID } from "crypto";
import type { ToolSet, TextStreamPart } from "ai";
import type {
  AIChatTextPart,
  AIChatToolCallPart,
  AIChatToolResultPart,
} from "shared/ai-chat";
import { stringifyToolResultForStorage } from "shared/ai-chat";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import { serializeUnknownForSSE } from "back-end/src/enterprise/services/sse-utils";

// =============================================================================
// Types
// =============================================================================

export type AgentEmit = (event: string, data: unknown) => void;
export type AgentStreamPart = TextStreamPart<ToolSet>;

type TextDeltaPart = Extract<AgentStreamPart, { type: "text-delta" }>;
type ToolInputStartPart = Extract<
  AgentStreamPart,
  { type: "tool-input-start" }
>;
type ToolInputDeltaPart = Extract<
  AgentStreamPart,
  { type: "tool-input-delta" }
>;
type ToolCallPart = Extract<AgentStreamPart, { type: "tool-call" }>;
type ToolResultPart = Extract<AgentStreamPart, { type: "tool-result" }>;
type ToolErrorPart = Extract<AgentStreamPart, { type: "tool-error" }>;

// =============================================================================
// StreamProcessor
// =============================================================================

const DEFAULT_CONSECUTIVE_TOOL_ERROR_LIMIT = 3;

/**
 * Accumulates AI SDK stream parts into assistant/tool messages and flushes them
 * to the conversation buffer at step boundaries. Holds all mutable accumulator
 * state so it does not leak into the stream loop or callers.
 */
export class StreamProcessor {
  private assistantParts: (AIChatTextPart | AIChatToolCallPart)[] = [];
  private pendingToolResults: AIChatToolResultPart[] = [];
  private textBuffer = "";
  private invalidToolCallIds = new Set<string>();
  private consecutiveToolErrors = 0;
  private aborted = false;
  private pendingError: string | null = null;
  private readonly onStepPersist?: () => void;

  constructor(
    private readonly buffer: ConversationBuffer,
    private readonly emit: AgentEmit,
    private readonly abortController: AbortController,
    private readonly maxConsecutiveToolErrors: number = DEFAULT_CONSECUTIVE_TOOL_ERROR_LIMIT,
    onStepPersist?: () => void,
  ) {
    this.onStepPersist = onStepPersist;
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Record a stream-level error to be persisted as an `isError` assistant
   * message when {@link flush} runs.
   */
  setError(message: string): void {
    this.pendingError = message;
  }

  private triggerCircuitBreaker(): void {
    if (this.aborted) return;
    if (this.consecutiveToolErrors >= this.maxConsecutiveToolErrors) {
      this.aborted = true;
      const message =
        "The assistant encountered repeated tool errors and stopped retrying. " +
        "Please try rephrasing your request or adjusting the parameters.";
      this.emit("error", { message });
      this.pendingError = message;
      this.abortController.abort();
    }
  }

  private flushTextToAssistantParts(): void {
    const trimmed = this.textBuffer.trim();
    if (trimmed) {
      this.assistantParts.push({ type: "text", text: trimmed });
    }
    this.textBuffer = "";
  }

  private flushAssistantMessage(): void {
    this.flushTextToAssistantParts();
    if (this.assistantParts.length > 0) {
      this.buffer.appendMessages([
        {
          role: "assistant",
          id: randomUUID(),
          ts: Date.now(),
          content: this.assistantParts.splice(0),
        },
      ]);
    }
  }

  private flushToolMessage(): void {
    if (this.pendingToolResults.length > 0) {
      this.buffer.appendMessages([
        {
          role: "tool",
          id: randomUUID(),
          ts: Date.now(),
          content: this.pendingToolResults.splice(0),
        },
      ]);
    }
  }

  handleTextDelta(part: TextDeltaPart): void {
    if (this.pendingToolResults.length > 0) {
      this.flushToolMessage();
    }
    this.textBuffer += part.text;
    this.emit("text-delta", { content: part.text });
  }

  handleToolInputStart(part: ToolInputStartPart): void {
    this.emit("tool-call-start", {
      toolName: part.toolName,
      toolCallId: part.id,
    });
  }

  handleToolInputDelta(part: ToolInputDeltaPart): void {
    const toolCallId = getStringProperty(part, "id");
    const delta = getStringProperty(part, "delta");
    if (!toolCallId || !delta) return;

    this.emit("tool-call-args-delta", { toolCallId, inputTextDelta: delta });
  }

  handleToolCall(part: ToolCallPart): void {
    const toolCallId = getStringProperty(part, "toolCallId");
    const toolName = getStringProperty(part, "toolName");
    if (!toolCallId || !toolName) return;

    const rawInput = "input" in part ? part.input : undefined;
    const invalid = "invalid" in part && Boolean(part.invalid);
    const rawError = "error" in part ? part.error : undefined;
    const errorText =
      invalid && rawError != null
        ? getErrorMessage(rawError, "Invalid tool input")
        : undefined;

    if (invalid && toolCallId) {
      this.invalidToolCallIds.add(toolCallId);
    }

    this.emit("tool-call-input", {
      toolCallId,
      toolName,
      input: serializeUnknownForSSE(rawInput),
      ...(invalid ? { invalid: true as const } : {}),
      ...(errorText != null ? { errorText } : {}),
    });

    if (this.pendingToolResults.length > 0) {
      this.flushToolMessage();
    }

    this.flushTextToAssistantParts();

    const args =
      rawInput && typeof rawInput === "object" && rawInput !== null
        ? (rawInput as Record<string, unknown>)
        : undefined;

    this.assistantParts.push({
      type: "tool-call",
      toolCallId,
      toolName,
      args: args ?? {},
    });
  }

  handleToolResult(part: ToolResultPart): void {
    const preliminary = "preliminary" in part && Boolean(part.preliminary);
    const rawInput = "input" in part ? part.input : undefined;

    this.emit("tool-call-end", {
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      output: serializeUnknownForSSE(part.output),
      ...(rawInput !== undefined
        ? { input: serializeUnknownForSSE(rawInput) }
        : {}),
      ...(preliminary ? { preliminary: true as const } : {}),
    });

    if (preliminary) return;

    if (
      this.pendingToolResults.length === 0 &&
      this.assistantParts.length > 0
    ) {
      this.flushAssistantMessage();
    }

    const isError = this.invalidToolCallIds.has(part.toolCallId);
    this.pendingToolResults.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      result: stringifyToolResultForStorage(part.output),
      ...(isError ? { isError: true } : {}),
    });

    if (isError || isErrorToolOutput(part.output)) {
      this.consecutiveToolErrors++;
      this.triggerCircuitBreaker();
    } else {
      this.consecutiveToolErrors = 0;
    }

    this.flushToolMessage();
    this.onStepPersist?.();
  }

  handleToolError(part: ToolErrorPart): void {
    const toolCallId = getStringProperty(part, "toolCallId");
    if (!toolCallId) return;

    const toolName = getStringProperty(part, "toolName");
    const message = getErrorMessage(
      "error" in part ? part.error : undefined,
      "Tool execution failed",
    );
    this.emit("tool-call-error", {
      toolCallId,
      ...(toolName ? { toolName } : {}),
      message,
    });

    if (
      this.pendingToolResults.length === 0 &&
      this.assistantParts.length > 0
    ) {
      this.flushAssistantMessage();
    }
    this.pendingToolResults.push({
      type: "tool-result",
      toolCallId,
      toolName: toolName ?? "",
      result: message,
      isError: true,
    });

    this.consecutiveToolErrors++;
    this.triggerCircuitBreaker();

    this.flushToolMessage();
    this.onStepPersist?.();
  }

  /** Flush whatever remains after the stream ends. */
  flush(): void {
    this.flushAssistantMessage();
    this.flushToolMessage();

    if (this.pendingError) {
      this.buffer.appendMessages([
        {
          role: "assistant",
          id: randomUUID(),
          ts: Date.now(),
          content: this.pendingError,
          isError: true,
        },
      ]);
      this.pendingError = null;
    }
  }
}

// =============================================================================
// Small utilities
// =============================================================================

function isErrorToolOutput(output: unknown): boolean {
  if (output && typeof output === "object" && "status" in output) {
    return (output as { status: unknown }).status === "error";
  }
  return false;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error == null) return fallback;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
