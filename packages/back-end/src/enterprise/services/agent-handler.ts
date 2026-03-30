import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ToolSet, TextStreamPart } from "ai";
import type { AIPromptType } from "shared/ai";
import type { RichMessage } from "shared";
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
import {
  peekToolOutputToRich,
  stripForLLM,
} from "back-end/src/enterprise/services/rich-message";
import { clearPendingToolArtifactsForConversation } from "back-end/src/enterprise/services/pending-tool-artifacts";
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
    emit: AgentEmit,
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

    resetSnapshotSlotCounter(conversationId);

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

    const userMessage: RichMessage = {
      kind: "user-text",
      id: randomUUID(),
      content: message,
      ts: Date.now(),
    };
    appendMessages(conversationId, [userMessage]);
    const fullRich = getConversation(conversationId);
    const messagesForLLM = stripForLLM(fullRich);

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

    let assistantTextBuffer = "";

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
            assistantTextBuffer += part.text;
            emit("text-delta", { content: part.text });
            break;
          case "tool-input-start":
            emit("tool-call-start", {
              toolName: part.toolName,
              toolCallId: part.id,
            });
            break;
          case "tool-input-delta": {
            const toolCallId =
              "id" in part && typeof part.id === "string" ? part.id : "";
            const delta =
              "delta" in part && typeof part.delta === "string"
                ? part.delta
                : "";
            if (toolCallId && delta) {
              emit("tool-call-args-delta", {
                toolCallId,
                inputTextDelta: delta,
              });
            }
            break;
          }
          case "tool-call": {
            const toolCallId =
              "toolCallId" in part && typeof part.toolCallId === "string"
                ? part.toolCallId
                : "";
            const toolName =
              "toolName" in part && typeof part.toolName === "string"
                ? part.toolName
                : "";
            if (!toolCallId || !toolName) break;

            const rawInput = "input" in part ? part.input : undefined;
            const invalid = "invalid" in part && Boolean(part.invalid);
            let errorText: string | undefined;
            if (invalid && "error" in part && part.error != null) {
              errorText =
                part.error instanceof Error
                  ? part.error.message
                  : typeof part.error === "string"
                    ? part.error
                    : JSON.stringify(part.error);
            }

            emit("tool-call-input", {
              toolCallId,
              toolName,
              input: serializeUnknownForSSE(rawInput),
              ...(invalid ? { invalid: true as const } : {}),
              ...(errorText != null ? { errorText } : {}),
            });

            const trimmed = assistantTextBuffer.trim();
            if (trimmed) {
              appendMessages(conversationId, [
                {
                  kind: "assistant-text",
                  id: randomUUID(),
                  content: trimmed,
                  ts: Date.now(),
                },
              ]);
              assistantTextBuffer = "";
            }

            const args =
              rawInput &&
              typeof rawInput === "object" &&
              rawInput !== null &&
              !invalid
                ? (rawInput as Record<string, unknown>)
                : undefined;
            appendMessages(conversationId, [
              {
                kind: "tool-call",
                id: randomUUID(),
                toolName,
                toolCallId,
                ...(args ? { args } : {}),
                ts: Date.now(),
              },
            ]);
            break;
          }
          case "tool-result": {
            const preliminary =
              "preliminary" in part && Boolean(part.preliminary);
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

            if (!preliminary) {
              const { summary, data } = peekToolOutputToRich(
                conversationId,
                part.toolName,
                part.toolCallId,
                part.output,
              );
              appendMessages(conversationId, [
                {
                  kind: "tool-result",
                  id: randomUUID(),
                  toolName: part.toolName,
                  toolCallId: part.toolCallId,
                  summary,
                  data,
                  ts: Date.now(),
                },
              ]);
            }
            break;
          }
          case "tool-error": {
            const toolCallId =
              "toolCallId" in part && typeof part.toolCallId === "string"
                ? part.toolCallId
                : "";
            const toolName =
              "toolName" in part && typeof part.toolName === "string"
                ? part.toolName
                : "";
            const message =
              "error" in part && part.error instanceof Error
                ? part.error.message
                : "error" in part && typeof part.error === "string"
                  ? part.error
                  : "Tool execution failed";
            if (toolCallId) {
              emit("tool-call-error", {
                toolCallId,
                ...(toolName ? { toolName } : {}),
                message,
              });
            }
            break;
          }
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

    const tail = assistantTextBuffer.trim();
    if (tail) {
      appendMessages(conversationId, [
        {
          kind: "assistant-text",
          id: randomUUID(),
          content: tail,
          ts: Date.now(),
        },
      ]);
    }

    try {
      await stream.response;
    } catch {
      // Stream may already be settled; ignore
    }

    try {
      clearSessionLatestExplorationConfig(conversationId);
      clearPendingSnapshotsForConversation(conversationId);
      clearPendingToolArtifactsForConversation(conversationId);
    } catch {
      // ignore cleanup errors
    }

    // --- Clear streaming flag and finalize ---
    setStreaming(conversationId, false);
    emit("done", {});
    flushableRes.end();
  };
}
