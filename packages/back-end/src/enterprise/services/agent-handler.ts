import type { Response } from "express";
import type { ModelMessage, ToolSet, TextStreamPart } from "ai";
import type { AIPromptType } from "shared/ai";
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
import { logger } from "back-end/src/util/logger";

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
    emit: AgentEmit,
  ) => ToolSet;

  temperature?: number;
  maxSteps?: number;

  /**
   * Transform messages before sending to the LLM (e.g. context compaction).
   * The conversation store always receives the uncompacted originals.
   */
  preSubmit?: (messages: ModelMessage[]) => ModelMessage[];

  /**
   * Called after the default SSE mapping for every AI SDK stream part.
   * Use this to emit additional events. Default events (text-delta,
   * tool-call-start, tool-call-end, reasoning-delta, error) are always emitted.
   */
  onLLMEvent?: (part: TextStreamPart<ToolSet>, emit: AgentEmit) => void;
}

type FlushableResponse = Response & { flush?: () => void };

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
    req: AuthRequest<
      { message: string; conversationId: string } & Record<string, unknown>
    >,
    res: Response,
  ): Promise<void> => {
    const flushableRes = res as FlushableResponse;
    const body = req.body as {
      message: string;
      conversationId: string;
    } & Record<string, unknown>;
    const { message, conversationId } = body;
    const context = getContextFromReq(req);

    // --- Gate: commercial feature ---
    if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
      res.status(403).json({
        status: 403,
        message: "Your plan does not support AI features.",
      });
      return;
    }

    // --- Gate: AI enabled ---
    const { aiEnabled } = getAISettingsForOrg(context);
    if (!aiEnabled) {
      res.status(404).json({
        status: 404,
        message: "AI configuration not set or enabled",
      });
      return;
    }

    // --- Gate: rate limit ---
    const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
    if (secondsUntilReset > 0) {
      res.status(429).json({
        status: 429,
        message: "Over AI usage limits",
        retryAfter: secondsUntilReset,
      });
      return;
    }

    // --- Parse agent-specific params ---
    const params = config.parseParams(body);

    // --- Build system prompt ---
    const agentSystemPrompt = await config.buildSystemPrompt(context, params);
    const { prompt: orgAdditionalPrompt, overrideModel } =
      await context.models.aiPrompts.getAIPrompt(config.promptType);
    const system = orgAdditionalPrompt
      ? agentSystemPrompt + "\n" + orgAdditionalPrompt
      : agentSystemPrompt;

    // --- Load conversation history and append user message ---
    const history = getConversation(conversationId);

    // Initialise metadata for brand-new conversations (no-op on subsequent turns)
    if (history.length === 0) {
      initConversation(
        conversationId,
        context.userId,
        context.org.id,
        message.slice(0, 80),
      );
    }

    const userMessage: ModelMessage = { role: "user", content: message };
    const fullMessages: ModelMessage[] = [...history, userMessage];

    // --- Pre-submit hook (e.g. compaction) ---
    const messagesForLLM = config.preSubmit
      ? config.preSubmit(fullMessages)
      : fullMessages;

    // --- Set SSE response headers ---
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    flushableRes.flushHeaders?.();

    // --- SSE emit helper ---
    const emit: AgentEmit = (event, data) => {
      flushableRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      flushableRes.flush?.();
      touchStreamedAt(conversationId);
    };

    // --- Build tools (tools can call emit directly during execute) ---
    const tools = config.buildTools(context, conversationId, params, emit);

    // --- Mark stream as active ---
    setStreaming(conversationId, true);

    // --- Start streaming ---
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

    try {
      for await (const part of stream.fullStream) {
        if (part.type !== "text-delta" && part.type !== "reasoning-delta") {
          logger.debug(`[AI agent stream] part.type=${part.type}`, {
            conversationId,
            promptType: config.promptType,
            part: JSON.stringify(part),
          });
        }

        // Default event mapping — always emitted
        switch (part.type) {
          case "text-delta":
            emit("text-delta", { content: part.text });
            break;
          case "tool-input-start":
            emit("tool-call-start", {
              toolName: part.toolName,
              toolCallId: part.id,
            });
            break;
          case "tool-result":
            emit("tool-call-end", {
              toolName: part.toolName,
              toolCallId: part.toolCallId,
            });
            break;
          case "reasoning-delta":
            emit("reasoning-delta", { text: part.text });
            break;
          case "error":
            emit("error", {
              message:
                part.error instanceof Error
                  ? part.error.message
                  : "An error occurred",
            });
            break;
          default:
            break;
        }

        // Agent hook for additional/custom events
        config.onLLMEvent?.(part, emit);
      }
    } catch (err) {
      emit("error", {
        message: err instanceof Error ? err.message : "An error occurred",
      });
    }

    // --- Persist full (uncompacted) messages to conversation store ---
    try {
      const response = await stream.response;
      appendMessages(conversationId, [userMessage, ...response.messages]);
    } catch {
      // Non-fatal: next turn will just lose this turn's history
    }

    // --- Clear streaming flag and finalize ---
    setStreaming(conversationId, false);
    emit("done", {});
    flushableRes.end();
  };
}
