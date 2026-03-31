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
import { stringifyToolResultForStorage } from "shared/ai-chat";
import {
  clearSessionLatestExplorationConfig,
  resetSnapshotSlotCounter,
} from "back-end/src/enterprise/services/exploration-session-config";
import { clearPendingSnapshotsForConversation } from "back-end/src/enterprise/services/pending-snapshot-lookup";
import { logger } from "back-end/src/util/logger";
import { serializeUnknownForSSE } from "back-end/src/enterprise/services/sse-tool-payload";

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
   * Called after the default SSE mapping for every AI SDK stream part.
   * Use this to emit additional events. Default events (text-delta,
   * tool-call-start, tool-call-args-delta, tool-call-input, tool-call-end with
   * output, tool-call-error, reasoning-delta, error) are always emitted.
   */
  onLLMEvent?: (part: TextStreamPart<ToolSet>, emit: AgentEmit) => void;
}

type FlushableResponse = Response & { flush?: () => void };
type AgentStreamPart = TextStreamPart<ToolSet>;
type ToolInputStartPart = Extract<AgentStreamPart, { type: "tool-input-start" }>;
type ToolInputDeltaPart = Extract<AgentStreamPart, { type: "tool-input-delta" }>;
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

function getStringProperty(
  value: unknown,
  key: string,
): string | undefined {
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

async function streamAgentResponse(
  stream: Awaited<ReturnType<typeof streamingChatCompletion>>,
  config: AgentConfig,
  conversationId: string,
  emit: AgentEmit,
): Promise<void> {
  // Per-step accumulators: batched into one assistant message + one tool message per step.
  const assistantParts: (AIChatTextPart | AIChatToolCallPart)[] = [];
  const pendingToolResults: AIChatToolResultPart[] = [];
  let textBuffer = "";

  const flushTextToAssistantParts = (): void => {
    const trimmed = textBuffer.trim();
    if (trimmed) {
      assistantParts.push({ type: "text", text: trimmed });
    }
    textBuffer = "";
  };

  const flushAssistantMessage = (): void => {
    flushTextToAssistantParts();
    if (assistantParts.length > 0) {
      appendMessages(conversationId, [
        {
          role: "assistant",
          id: randomUUID(),
          ts: Date.now(),
          content: assistantParts.splice(0),
        },
      ]);
    }
  };

  const flushToolMessage = (): void => {
    if (pendingToolResults.length > 0) {
      appendMessages(conversationId, [
        {
          role: "tool",
          id: randomUUID(),
          ts: Date.now(),
          content: pendingToolResults.splice(0),
        },
      ]);
    }
  };

  try {
    for await (const part of stream.fullStream) {
      debugNonTextPart(part, conversationId, config.promptType);

      switch (part.type) {
        case "text-delta":
          // Tool results from the previous step are now finalized — flush them.
          if (pendingToolResults.length > 0) {
            flushToolMessage();
          }
          textBuffer += part.text;
          emit("text-delta", { content: part.text });
          break;

        case "tool-input-start":
          emitToolInputStart(part, emit);
          break;

        case "tool-input-delta":
          emitToolInputDelta(part, emit);
          break;

        case "tool-call":
          emitToolCall(
            part,
            emit,
            flushTextToAssistantParts,
            assistantParts,
            flushToolMessage,
            pendingToolResults,
          );
          break;

        case "tool-result":
          emitToolResult(
            part,
            emit,
            flushAssistantMessage,
            assistantParts,
            pendingToolResults,
          );
          break;

        case "tool-error":
          emitToolError(part, emit);
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

  // Flush whatever remains after the stream ends.
  flushAssistantMessage();
  flushToolMessage();
}

function cleanupConversationArtifacts(conversationId: string): void {
  clearSessionLatestExplorationConfig(conversationId);
  clearPendingSnapshotsForConversation(conversationId);
}

function emitToolInputStart(part: ToolInputStartPart, emit: AgentEmit): void {
  emit("tool-call-start", {
    toolName: part.toolName,
    toolCallId: part.id,
  });
}

function emitToolInputDelta(part: ToolInputDeltaPart, emit: AgentEmit): void {
  const toolCallId = getStringProperty(part, "id");
  const delta = getStringProperty(part, "delta");
  if (!toolCallId || !delta) return;

  emit("tool-call-args-delta", {
    toolCallId,
    inputTextDelta: delta,
  });
}

function emitToolCall(
  part: ToolCallPart,
  emit: AgentEmit,
  flushText: () => void,
  assistantParts: (AIChatTextPart | AIChatToolCallPart)[],
  flushToolMessage: () => void,
  pendingToolResults: AIChatToolResultPart[],
): void {
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

  emit("tool-call-input", {
    toolCallId,
    toolName,
    input: serializeUnknownForSSE(rawInput),
    ...(invalid ? { invalid: true as const } : {}),
    ...(errorText != null ? { errorText } : {}),
  });

  // If there are pending tool results from the previous step (no text-delta arrived
  // to flush them), do it now so we don't mix results from different assistant turns.
  if (pendingToolResults.length > 0) {
    flushToolMessage();
  }

  flushText();

  const args =
    rawInput &&
    typeof rawInput === "object" &&
    rawInput !== null &&
    !invalid
      ? (rawInput as Record<string, unknown>)
      : undefined;

  assistantParts.push({
    type: "tool-call",
    toolCallId,
    toolName,
    args: args ?? {},
  });
}

function emitToolResult(
  part: ToolResultPart,
  emit: AgentEmit,
  flushAssistantMessage: () => void,
  assistantParts: (AIChatTextPart | AIChatToolCallPart)[],
  pendingToolResults: AIChatToolResultPart[],
): void {
  const preliminary = "preliminary" in part && Boolean(part.preliminary);
  const rawInput = "input" in part ? part.input : undefined;

  emit("tool-call-end", {
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
  if (pendingToolResults.length === 0 && assistantParts.length > 0) {
    flushAssistantMessage();
  }

  pendingToolResults.push({
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    result: stringifyToolResultForStorage(part.output),
  });
}

function emitToolError(part: ToolErrorPart, emit: AgentEmit): void {
  const toolCallId = getStringProperty(part, "toolCallId");
  if (!toolCallId) return;

  const toolName = getStringProperty(part, "toolName");
  const message = getErrorMessage(
    "error" in part ? part.error : undefined,
    "Tool execution failed",
  );
  emit("tool-call-error", {
    toolCallId,
    ...(toolName ? { toolName } : {}),
    message,
  });
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

/**
 * Creates an Express request handler from an AgentConfig. The returned handler
 * owns the full lifecycle: gating, conversation history, system prompt assembly,
 * streaming, SSE event mapping, and message persistence.
 *
 * Every POST body must include `message: string` and `conversationId: string`.
 * Agent-specific body fields are extracted via `config.parseParams`.
 */
export function createAgentHandler<TParams>(config: AgentConfig<TParams>) {
  return async (
    req: AuthRequest<AgentRequestBody>,
    res: Response,
  ): Promise<void> => {
    const flushableRes = res as FlushableResponse;
    const body = req.body as AgentRequestBody;
    const { message, conversationId } = body;
    const context = getContextFromReq(req);

    resetSnapshotSlotCounter(conversationId);

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

      await streamAgentResponse(
        stream,
        config,
        conversationId,
        emit,
      );

      try {
        await stream.response;
      } catch {
        // Stream may already be settled; ignore
      }
    } finally {
      try {
        cleanupConversationArtifacts(conversationId);
      } catch {
        // ignore cleanup errors
      }

      setStreaming(conversationId, false);
      emit("done", {});
      flushableRes.end();
    }
  };
}
