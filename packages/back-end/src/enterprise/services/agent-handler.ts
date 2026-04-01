import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ToolSet, TextStreamPart } from "ai";
import type { AIPromptType } from "shared/ai";
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
  secondsUntilAICanBeUsedAgain,
} from "back-end/src/enterprise/services/ai";
import {
  getConversation,
  appendMessages,
  setStreaming,
  touchStreamedAt,
  initConversation,
} from "back-end/src/enterprise/services/conversation-store";
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
   * The `emit` function writes SSE events directly from within tool execute
   * functions, allowing tools to stream rich artifacts (e.g. chart-result)
   * before the AI SDK yields the tool-result stream part.
   */
  buildTools: (
    ctx: ReqContext,
    conversationId: string,
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
// Helpers below are plain `function` declarations so they can live after this
// export without forward references issues at runtime.

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
    const { system, orgAdditionalPrompt, overrideModel } =
      await buildSystemPromptForRequest(context, config, params);
    const messagesForLLM = prepareConversationMessages(
      conversationId,
      context,
      message,
    );
    setSseHeaders(res);
    const emit = createEmit(flushableRes, conversationId);
    const tools = config.buildTools(context, conversationId, params, emit);

    setStreaming(conversationId, true);
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
      });

      await streamAgentResponse(stream, config, conversationId, emit);

      // Awaiting stream.response drains any buffered provider errors that
      // surface after the fullStream async iterator completes. Errors here
      // are safe to ignore since streamAgentResponse already handled them.
      try {
        await stream.response;
      } catch {
        // ignore
      }
    } finally {
      try {
        config.onCleanup?.(conversationId);
      } catch {
        // ignore cleanup errors
      }

      setStreaming(conversationId, false);
      emit("done", {});
      flushableRes.end();
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
// Conversation store: init, append user message, messages for the model
// =============================================================================

function prepareConversationMessages(
  conversationId: string,
  context: ReqContext,
  message: string,
): ReturnType<typeof stripForLLM> {
  const history = getConversation(conversationId);

  if (history.length === 0) {
    initConversation(
      conversationId,
      context.userId,
      context.org.id,
      message.slice(0, 80),
    );
  }

  const userMessage: AIChatMessage = {
    role: "user",
    id: randomUUID(),
    content: message,
    ts: Date.now(),
  };
  appendMessages(conversationId, [userMessage]);
  return stripForLLM(getConversation(conversationId));
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
  conversationId: string,
): AgentEmit {
  return (event, data): void => {
    flushableRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flushableRes.flush?.();
    touchStreamedAt(conversationId);
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
 * to the conversation store at step boundaries. Holds all mutable accumulator
 * state so it does not leak into the stream loop or callers.
 */
class StreamProcessor {
  private assistantParts: (AIChatTextPart | AIChatToolCallPart)[] = [];
  private pendingToolResults: AIChatToolResultPart[] = [];
  private textBuffer = "";

  constructor(
    private readonly conversationId: string,
    private readonly emit: AgentEmit,
  ) {}

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
      appendMessages(this.conversationId, [
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
      appendMessages(this.conversationId, [
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
      rawInput && typeof rawInput === "object" && rawInput !== null && !invalid
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

    this.pendingToolResults.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      result: stringifyToolResultForStorage(part.output),
    });
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
  }

  /** Flush whatever remains after the stream ends. */
  flush(): void {
    this.flushAssistantMessage();
    this.flushToolMessage();
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

async function streamAgentResponse(
  stream: Awaited<ReturnType<typeof streamingChatCompletion>>,
  config: AgentConfig,
  conversationId: string,
  emit: AgentEmit,
): Promise<void> {
  const processor = new StreamProcessor(conversationId, emit);

  try {
    for await (const part of stream.fullStream) {
      debugNonTextPart(part, conversationId, config.promptType);

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
        case "error":
          emit("error", {
            message: getErrorMessage(
              (part as ErrorPart).error,
              "An error occurred",
            ),
          });
          break;
        default:
          break;
      }

      config.onLLMEvent?.(part, emit);
    }
  } catch (err) {
    emit("error", { message: getErrorMessage(err, "An error occurred") });
  }

  processor.flush();
}

// =============================================================================
// Small utilities (stream parts + errors)
// =============================================================================

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
