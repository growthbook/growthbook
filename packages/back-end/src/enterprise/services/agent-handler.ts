import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ToolSet, TextStreamPart } from "ai";
import type { AIModel, AIPromptType } from "shared/ai";
import type { AIChatMessage } from "shared/ai-chat";
import type { ReqContext } from "back-end/types/request";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextFromReq,
  getAISettingsForOrg,
} from "back-end/src/services/organizations";
import {
  streamingChatCompletion,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import {
  type ConversationBuffer,
  loadOrInitConversation,
  persistConversation,
} from "back-end/src/enterprise/services/conversation-buffer";
import { toModelMessages } from "back-end/src/enterprise/services/ai-chat-to-model";
import { logger } from "back-end/src/util/logger";
import {
  runAccessGates,
  buildSystemPromptForRequest,
} from "back-end/src/enterprise/services/ai-access";
import {
  setSseHeaders,
  createEmit,
} from "back-end/src/enterprise/services/sse-utils";
import {
  StreamProcessor,
  getErrorMessage,
  type AgentEmit,
  type AgentStreamPart,
} from "back-end/src/enterprise/services/stream-processor";

// Re-export symbols that external consumers import from this module.
export type { AgentEmit } from "back-end/src/enterprise/services/stream-processor";
export {
  MAX_SSE_TOOL_JSON_LENGTH,
  serializeUnknownForSSE,
} from "back-end/src/enterprise/services/sse-utils";

// =============================================================================
// Public types
// =============================================================================

export interface AgentConfig<TParams = unknown> {
  /** Unique key that scopes conversations to this agent (e.g. "product-analytics"). */
  agentType: string;
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
// Internal types
// =============================================================================

type AgentRequestBody = {
  message: string;
  conversationId: string;
  model: AIModel;
} & Record<string, unknown>;

type ErrorPart = Extract<AgentStreamPart, { type: "error" }>;

// =============================================================================
// Active stream registry (supports explicit cancel via separate HTTP request)
// =============================================================================

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

// =============================================================================
// Main entry — Express handler factory
// =============================================================================

export function createAgentHandler<TParams>(config: AgentConfig<TParams>) {
  return async (
    req: AuthRequest<AgentRequestBody>,
    res: Response,
  ): Promise<void> => {
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
      config.agentType,
    );

    const requestModel = body.model;
    const canOverride = context.permissions.canManageOrgSettings();

    // Resolution: request (permitted) → conversation stored → org prompt override
    const overrideModel =
      (canOverride && requestModel) ||
      (buffer.getModel() as AIModel | undefined) ||
      dbOverrideModel ||
      undefined;

    const { defaultAIModel } = getAISettingsForOrg(context, false);
    const resolvedModel = overrideModel || defaultAIModel;
    buffer.setModel(resolvedModel);

    const { messages: messagesForLLM, isFirstMessage } =
      prepareConversationMessages(buffer, message);
    setSseHeaders(res);
    const emit = createEmit(res, buffer);
    const tools = config.buildTools(context, buffer, params, emit);

    buffer.setStreaming(true);

    persistConversation(context.models.aiConversations, buffer).catch((err) => {
      logger.error(err, "Failed to persist user message");
    });

    const titlePromise: Promise<void> = isFirstMessage
      ? generateTitle(context, config, message, overrideModel, buffer, emit)
      : Promise.resolve();

    const abortController = new AbortController();
    activeStreamControllers.set(conversationId, abortController);
    let cancelledExternally = false;

    const checkCancellation = async (): Promise<boolean> => {
      if (cancelledExternally) return true;
      const doc = await context.models.aiConversations.getById(conversationId);
      if (doc && !doc.isStreaming) {
        cancelledExternally = true;
        abortController.abort();
        return true;
      }
      return false;
    };

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

      await processStream(stream, config, buffer, emit, abortController, () => {
        void (async () => {
          if (await checkCancellation()) return;
          await persistConversation(context.models.aiConversations, buffer);
        })().catch((err) => {
          logger.error(
            err,
            "Failed to persist intermediate conversation state",
          );
        });
      });

      try {
        await stream.response;
      } catch {
        // Provider errors after stream close — already handled
      }

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
        res.end();
      }

      if (!cancelledExternally) {
        await checkCancellation();
      }
      if (!cancelledExternally) {
        persistConversation(context.models.aiConversations, buffer).catch(
          (err) => {
            logger.error(err, "Failed to persist conversation at stream end");
          },
        );
      }
    }
  };
}

// =============================================================================
// Helpers
// =============================================================================

function prepareConversationMessages(
  buffer: ConversationBuffer,
  message: string,
): { messages: ReturnType<typeof toModelMessages>; isFirstMessage: boolean } {
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
    messages: toModelMessages(buffer.getMessages()),
    isFirstMessage,
  };
}

async function generateTitle<TParams>(
  context: ReqContext,
  config: AgentConfig<TParams>,
  message: string,
  overrideModel: AIModel | undefined,
  buffer: ConversationBuffer,
  emit: AgentEmit,
): Promise<void> {
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

async function processStream<TParams>(
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
    if (!processor.isAborted && !abortController.signal.aborted) {
      const errorMsg = getErrorMessage(err, "An error occurred");
      emit("error", { message: errorMsg });
      processor.setError(errorMsg);
    }
  }

  processor.flush();
}
