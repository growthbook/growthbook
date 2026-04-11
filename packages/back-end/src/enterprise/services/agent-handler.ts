import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ToolSet, TextStreamPart } from "ai";
import type { AIModel, AIPromptType } from "shared/ai";
import type {
  AIChatMessage,
  AIChatTextPart,
  AIChatToolCallPart,
  AIChatToolResultPart,
} from "shared/ai-chat";
import { stringifyToolResultForStorage } from "shared/ai-chat";
import type { ReqContext } from "back-end/types/request";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getAISettingsForOrg,
} from "back-end/src/services/organizations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  streamingChatCompletion,
  simpleCompletion,
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import {
  type ConversationBuffer,
  loadOrInitConversation,
  persistConversation,
} from "back-end/src/enterprise/services/conversation-buffer";
import { stripForLLM } from "back-end/src/enterprise/services/ai-chat-for-llm";
import { logger } from "back-end/src/util/logger";

// =============================================================================
// Public types
// =============================================================================

export type AgentEmit = (event: string, data: unknown) => void;

export interface AgentConfig<TParams = unknown> {
  promptType: AIPromptType;

  /** Parse agent-specific params from the full request body */
  parseParams: (body: Record<string, unknown>) => TParams;

  /** Build the system prompt for the current request */
  buildSystemPrompt: (ctx: ReqContext, params: TParams) => Promise<string>;

  /**
   * Build the tool set for the current request.
   * The `buffer` provides sync access to the conversation's messages and
   * metadata within tool execute functions. The `emit` function writes SSE
   * events directly from within tool execute functions, allowing tools to
   * stream rich artifacts (e.g. chart-result) before the AI SDK yields the
   * tool-result stream part.
   */
  buildTools: (
    ctx: ReqContext,
    buffer: ConversationBuffer,
    params: TParams,
    emit?: AgentEmit,
  ) => ToolSet;

  temperature?: number;
  maxSteps?: number;

  /**
   * Called at the start of each request, before streaming begins.
   * Use this for per-request state initialization (e.g. resetting slot counters).
   */
  onStreamStart?: (conversationId: string) => void;

  /**
   * Called after the stream completes (or errors), before the response is closed.
   * Use this to clean up per-request in-memory state.
   */
  onCleanup?: (conversationId: string) => void;

  /**
   * Called after the default SSE mapping for every AI SDK stream part.
   * Use this to emit additional events. Default events (text-delta,
   * tool-call-start, tool-call-args-delta, tool-call-input, tool-call-end with
   * output, tool-call-error, reasoning-delta, error) are always emitted.
   */
  onLLMEvent?: (part: TextStreamPart<ToolSet>, emit: AgentEmit) => void;

  /**
   * Maximum consecutive tool-call errors (SDK errors, invalid inputs, or
   * application-level `{ status: "error" }` results) before the agent aborts
   * with a user-facing message. Defaults to 3.
   */
  maxConsecutiveToolErrors?: number;
}

// =============================================================================
// Internal types (AI SDK stream parts + request shape)
// =============================================================================

type FlushableResponse = Response & { flush?: () => void };
type AgentStreamPart = TextStreamPart<ToolSet>;
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
type ErrorPart = Extract<AgentStreamPart, { type: "error" }>;
type AgentRequestBody = {
  message: string;
  conversationId: string;
  model: AIModel;
} & Record<string, unknown>;
type OrgAIPromptConfig = Awaited<
  ReturnType<ReqContext["models"]["aiPrompts"]["getAIPrompt"]>
>;

// =============================================================================
// Main entry — Express handler factory
// =============================================================================
//
// Creates a POST handler from AgentConfig: premium/AI gates, conversation
// history, system prompt, streaming completion, SSE mapping, and persistence.
// Body must include `message` and `conversationId`; extra fields go through
// `config.parseParams`.
//
// The ConversationBuffer lives on the stack for the duration of the request
// and is GC'd when the handler returns — no module-level state apart from the
// activeStreamControllers registry which enables explicit cancel via a separate
// HTTP request (as opposed to aborting on SSE disconnect).

const activeStreamControllers = new Map<string, AbortController>();

/**
 * Abort the active LLM stream for a conversation. Called from the cancel
 * endpoint — returns true if there was a stream to abort.
 */
export function cancelAgentStream(conversationId: string): boolean {
  const controller = activeStreamControllers.get(conversationId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

export function createAgentHandler<TParams>(config: AgentConfig<TParams>) {
  return async (
    req: AuthRequest<AgentRequestBody>,
    res: Response,
  ): Promise<void> => {
    const flushableRes = res as FlushableResponse;
    const body = req.body as AgentRequestBody;
    const { message, conversationId } = body;
    const context = getContextFromReq(req);

    config.onStreamStart?.(conversationId);

    if (!(await runAccessGates(context, res))) {
      return;
    }

    const params = config.parseParams(body);
    const {
      system,
      orgAdditionalPrompt,
      overrideModel: dbOverrideModel,
    } = await buildSystemPromptForRequest(context, config, params);
    const buffer = await loadOrInitConversation(
      context.models.aiConversations,
      conversationId,
      context.userId,
    );

    const requestModel = body.model;
    const canOverride = context.permissions.canManageOrgSettings();

    // Persist the model selection to the conversation when the user has permission.
    if (canOverride) {
      buffer.setModel(requestModel);
    }

    // Resolution: request (permitted) → conversation stored → org prompt override
    const overrideModel =
      (canOverride && requestModel) ||
      (buffer.getModel() as AIModel | undefined) ||
      dbOverrideModel ||
      undefined;

    const { messages: messagesForLLM, isFirstMessage } =
      prepareConversationMessages(buffer, message);
    setSseHeaders(res);
    const emit = createEmit(flushableRes, buffer);
    const tools = config.buildTools(context, buffer, params, emit);

    buffer.setStreaming(true);

    // Persist user message immediately so it survives a mid-stream server crash.
    persistConversation(context.models.aiConversations, buffer).catch((err) => {
      logger.error(err, "Failed to persist user message");
    });

    // Fire title generation immediately from the user's message so it runs
    // concurrently with the main stream and resolves as early as possible.
    const titlePromise: Promise<void> = isFirstMessage
      ? (async () => {
          try {
            const raw = await simpleCompletion({
              context,
              instructions:
                "You are a title generator. Respond with ONLY a 3-6 word title for the user's data analytics request. Output nothing else — no explanation, no punctuation wrapping, no markdown.",
              prompt: message,
              temperature: 0.3,
              type: config.promptType,
              isDefaultPrompt: true,
              overrideModel,
            });
            // Take only the first non-empty line in case the model adds extra text
            const firstLine =
              raw
                .split(/\r?\n/)
                .map((l) => l.trim())
                .find((l) => l.length > 0) ?? "";
            const trimmedTitle = firstLine
              .replace(/^["'`#*_\s]+|["'`#*_\s]+$/g, "")
              .slice(0, 100);
            if (trimmedTitle) {
              buffer.updateTitle(trimmedTitle);
              emit("conversation-title", { title: trimmedTitle });
            }
          } catch {
            // Title generation is non-critical; leave "New Chat"
          }
        })()
      : Promise.resolve();

    const abortController = new AbortController();
    activeStreamControllers.set(conversationId, abortController);

    try {
      const stream = await streamingChatCompletion({
        context,
        system,
        messages: messagesForLLM,
        temperature: config.temperature,
        type: config.promptType,
        isDefaultPrompt: !orgAdditionalPrompt,
        overrideModel,
        tools,
        maxSteps: config.maxSteps,
        abortSignal: abortController.signal,
      });

      await streamAgentResponse(
        stream,
        config,
        buffer,
        emit,
        abortController,
        () => {
          persistConversation(context.models.aiConversations, buffer).catch(
            (err) => {
              logger.error(
                err,
                "Failed to persist intermediate conversation state",
              );
            },
          );
        },
      );

      // Awaiting stream.response drains any buffered provider errors that
      // surface after the fullStream async iterator completes. Errors here
      // are safe to ignore since streamAgentResponse already handled them.
      try {
        await stream.response;
      } catch {
        // ignore
      }

      // Ensure title is emitted before the connection closes, even if the
      // main stream finished faster than the title generation.
      await titlePromise;
    } finally {
      activeStreamControllers.delete(conversationId);

      try {
        config.onCleanup?.(conversationId);
      } catch {
        // ignore cleanup errors
      }

      buffer.setStreaming(false);
      if (!res.writableFinished && !res.destroyed) {
        emit("done", {});
        flushableRes.end();
      }

      // Persist final conversation state to DB after the response is closed.
      // Fire-and-forget — the client has already received "done".
      // The buffer is GC'd after this handler returns; no eviction needed.
      persistConversation(context.models.aiConversations, buffer).catch(
        (err) => {
          logger.error(err, "Failed to persist conversation at stream end");
        },
      );
    }
  };
}

// =============================================================================
// Access gates & org AI settings
// =============================================================================

async function runAccessGates(
  context: ReqContext,
  res: Response,
): Promise<boolean> {
  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    res.status(403).json({
      status: 403,
      message: "Your plan does not support AI features.",
    });
    return false;
  }

  const { aiEnabled } = getAISettingsForOrg(context);
  if (!aiEnabled) {
    res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
    return false;
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
    return false;
  }

  return true;
}

// =============================================================================
// System prompt + org prompt overlay
// =============================================================================

async function buildSystemPromptForRequest<TParams>(
  context: ReqContext,
  config: AgentConfig<TParams>,
  params: TParams,
): Promise<{
  system: string;
  orgAdditionalPrompt: OrgAIPromptConfig["prompt"];
  overrideModel: OrgAIPromptConfig["overrideModel"];
}> {
  const agentSystemPrompt = await config.buildSystemPrompt(context, params);
  const { prompt: orgAdditionalPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt(config.promptType);
  return {
    system: orgAdditionalPrompt
      ? agentSystemPrompt + "\n" + orgAdditionalPrompt
      : agentSystemPrompt,
    orgAdditionalPrompt,
    overrideModel,
  };
}

// =============================================================================
// Conversation buffer: append user message, prepare messages for the model
// =============================================================================

function prepareConversationMessages(
  buffer: ConversationBuffer,
  message: string,
): { messages: ReturnType<typeof stripForLLM>; isFirstMessage: boolean } {
  const history = buffer.getMessages();
  const isFirstMessage = history.length === 0;

  const userMessage: AIChatMessage = {
    role: "user",
    id: randomUUID(),
    content: message,
    ts: Date.now(),
  };
  buffer.appendMessages([userMessage]);
  return {
    messages: stripForLLM(buffer.getMessages()),
    isFirstMessage,
  };
}

// =============================================================================
// SSE response helpers
// =============================================================================

function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  (res as FlushableResponse).flushHeaders?.();
}

function createEmit(
  flushableRes: FlushableResponse,
  buffer: ConversationBuffer,
): AgentEmit {
  return (event, data): void => {
    try {
      flushableRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      flushableRes.flush?.();
    } catch {
      // Client disconnected — safe to ignore write failures
    }
    buffer.touchStreamedAt();
  };
}

/**
 * Serialize tool arguments / results for SSE JSON payloads.
 * Extremely large values are truncated with metadata so the UI can warn;
 * the limit is high so typical exploration / tool outputs are sent in full.
 */
export const MAX_SSE_TOOL_JSON_LENGTH = 2 * 1024 * 1024;

export function serializeUnknownForSSE(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    const s = JSON.stringify(value);
    if (s.length <= MAX_SSE_TOOL_JSON_LENGTH) {
      return JSON.parse(s) as unknown;
    }
    return {
      _truncated: true,
      preview: s.slice(0, MAX_SSE_TOOL_JSON_LENGTH),
      totalLength: s.length,
    };
  } catch {
    const str = String(value);
    if (str.length <= MAX_SSE_TOOL_JSON_LENGTH) {
      return { _nonJson: true, preview: str };
    }
    return {
      _nonJson: true,
      _truncated: true,
      preview: str.slice(0, MAX_SSE_TOOL_JSON_LENGTH),
      totalLength: str.length,
    };
  }
}

// =============================================================================
// Stream processing: AI SDK fullStream → SSE + persisted assistant/tool rows
// =============================================================================

/**
 * Accumulates AI SDK stream parts into assistant/tool messages and flushes them
 * to the conversation buffer at step boundaries. Holds all mutable accumulator
 * state so it does not leak into the stream loop or callers.
 */
const DEFAULT_CONSECUTIVE_TOOL_ERROR_LIMIT = 3;

class StreamProcessor {
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
    // Tool results from the previous step are now finalized — flush them.
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

    // If there are pending tool results from the previous step (no text-delta arrived
    // to flush them), do it now so we don't mix results from different assistant turns.
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

    // First real result of this batch: flush the assistant message (tool calls + any text).
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

    // Flush completed step to the buffer and persist so polling clients
    // (e.g. user navigated away and back) see intermediate results.
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

    // Persist the error as a tool result so the LLM sees it on the next turn.
    // Without this the conversation has an orphaned tool call with no matching
    // result, causing "No tool output found for function call" on subsequent
    // requests — and the model never learns what went wrong.
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

function debugNonTextPart(
  part: AgentStreamPart,
  conversationId: string,
  promptType: AIPromptType,
): void {
  if (part.type === "text-delta" || part.type === "reasoning-delta") return;

  logger.debug(`[AI agent stream] part.type=${part.type}`, {
    conversationId,
    promptType,
    part: JSON.stringify(part),
  });
}

async function streamAgentResponse<TParams>(
  stream: Awaited<ReturnType<typeof streamingChatCompletion>>,
  config: AgentConfig<TParams>,
  buffer: ConversationBuffer,
  emit: AgentEmit,
  abortController: AbortController,
  onStepPersist?: () => void,
): Promise<void> {
  const processor = new StreamProcessor(
    buffer,
    emit,
    abortController,
    config.maxConsecutiveToolErrors,
    onStepPersist,
  );

  try {
    for await (const part of stream.fullStream) {
      if (processor.isAborted) break;
      debugNonTextPart(part, buffer.conversationId, config.promptType);

      switch (part.type) {
        case "text-delta":
          processor.handleTextDelta(part);
          break;
        case "tool-input-start":
          processor.handleToolInputStart(part);
          break;
        case "tool-input-delta":
          processor.handleToolInputDelta(part);
          break;
        case "tool-call":
          processor.handleToolCall(part);
          break;
        case "tool-result":
          processor.handleToolResult(part);
          break;
        case "tool-error":
          processor.handleToolError(part);
          break;
        case "reasoning-delta":
          emit("reasoning-delta", { text: part.text });
          break;
        case "error": {
          const errorMsg = getErrorMessage(
            (part as ErrorPart).error,
            "An error occurred",
          );
          emit("error", { message: errorMsg });
          processor.setError(errorMsg);
          break;
        }
        default:
          break;
      }

      config.onLLMEvent?.(part, emit);
    }
  } catch (err) {
    if (!processor.isAborted) {
      const errorMsg = getErrorMessage(err, "An error occurred");
      emit("error", { message: errorMsg });
      processor.setError(errorMsg);
    }
  }

  processor.flush();
}

// =============================================================================
// Small utilities (stream parts + errors)
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error == null) return fallback;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
