import { randomUUID } from "crypto";
import type { Response } from "express";
import type { ToolSet, TextStreamPart } from "ai";
import type { AIModel, AIPromptType } from "shared/ai";
import type { AIChatMessage } from "shared/ai-chat";
import { getMessageText, stringifyToolResultForStorage } from "shared/ai-chat";
import type { AIAgentPendingAction } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  dispatchInternal,
  type DispatchInput,
} from "back-end/src/agent/dispatcher";
import {
  getContextFromReq,
  getAISettingsForOrg,
} from "back-end/src/services/organizations";
import {
  streamingChatCompletion,
  simpleCompletion,
} from "back-end/src/enterprise/services/ai";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  type ConversationBuffer,
  loadOrInitConversation,
  persistConversation,
} from "back-end/src/enterprise/services/conversation-buffer";
import { toModelMessages } from "back-end/src/enterprise/services/ai-chat-to-model";
import { logger } from "back-end/src/util/logger";
import {
  runAccessGates,
  checkAccessGates,
  buildSystemPromptForRequest,
} from "back-end/src/enterprise/services/ai-access";
import {
  setSseHeaders,
  createEmit,
  serializeUnknownForSSE,
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
   * When true, a `datasourceId` on the request body is persisted on the user
   * message as a soft `datasourceHint` and surfaced to the LLM via an
   * `[Active product-analytics datasource: …]` prefix (see `toModelMessages`).
   * Kept off the static system prompt so the prompt stays cache-friendly.
   * Agents that scope themselves to a datasource via params (e.g. PA chat)
   * leave this off and use the param directly instead.
   */
  injectDatasourceHint?: boolean;

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
  /**
   * Self-hosted callers may pick a model on the first turn; Cloud ignores it.
   * Optional so non-HTTP callers (e.g. the Slack bot) can omit it.
   */
  model?: AIModel;
  /**
   * Optional URL the user was on when they sent this message. Persisted
   * on the resulting `AIChatUserMessage` and surfaced to the LLM via a
   * `[Page context: …]` prefix in `toModelMessages`. Per-agent routers
   * decide whether to accept this field on the wire — agents that don't
   * need page awareness (e.g. PA chat) just won't pass it through.
   */
  currentPage?: string;
  /**
   * Optional product-analytics datasource the client had selected. When the
   * agent config sets `injectDatasourceHint`, this is persisted on the user
   * message as a soft `datasourceHint` (see `AIChatUserMessage`).
   */
  datasourceId?: string;
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
    const { conversationId } = body;
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

    setSseHeaders(res);
    const emit = createEmit(res, buffer);

    await executeAgentTurn({
      context,
      config,
      body,
      params,
      buffer,
      system,
      isDefaultPrompt: !orgAdditionalPrompt,
      dbOverrideModel,
      emit,
    });

    // executeAgentTurn already emitted "done" and persisted; close the SSE
    // stream if it's still open.
    if (!res.writableFinished && !res.destroyed) {
      res.end();
    }
  };
}

// =============================================================================
// Headless entry — run a turn to completion without an HTTP/SSE transport
// =============================================================================

export type RunAgentTurnResult =
  | {
      ok: true;
      conversationId: string;
      /** The assistant's final user-visible reply text (may be empty). */
      reply: string;
      /** A mutation the agent parked for confirmation, or null. */
      pendingAction: AIAgentPendingAction | null;
      /**
       * Experiment ids the agent asked to attach a results card for (via an
       * `experiment-card` emit from a tool). The caller renders + delivers them.
       */
      experimentCardIds: string[];
    }
  | { ok: false; status: number; message: string; retryAfter?: number };

/** Minimal input for a headless turn — the non-HTTP analogue of the chat request body. */
export interface HeadlessTurnInput {
  message: string;
  conversationId: string;
  /** Optional page/context hint, surfaced to the model the same way the UI does. */
  currentPage?: string;
  /** Optional product-analytics datasource hint (only used by agents that opt in). */
  datasourceId?: string;
  /**
   * Resolve a parked mutation from a prior turn. `confirmDecision: "confirm"`
   * dispatches the stored call; "cancel" records a rejection. `message` is
   * typically empty for these control turns.
   */
  confirmActionId?: string;
  confirmDecision?: "confirm" | "cancel";
}

/**
 * Run a single agent turn to completion with no HTTP/SSE transport and return
 * the assistant's final reply as a string. Used by non-browser callers (e.g.
 * the Slack bot) that need the answer rather than a stream.
 *
 * The caller must build a permission-scoped `context` for the acting user
 * (e.g. via getContextForUserIdInOrg) — the agent's API calls run with exactly
 * that context's permissions, so a Slack user can't read anything they
 * couldn't read in the app.
 */
export async function runAgentTurnToCompletion<TParams>({
  context,
  config,
  input,
}: {
  context: ReqContext;
  config: AgentConfig<TParams>;
  input: HeadlessTurnInput;
}): Promise<RunAgentTurnResult> {
  const body: AgentRequestBody = {
    message: input.message,
    conversationId: input.conversationId,
    ...(input.currentPage ? { currentPage: input.currentPage } : {}),
    ...(input.datasourceId ? { datasourceId: input.datasourceId } : {}),
    ...(input.confirmActionId
      ? { confirmActionId: input.confirmActionId }
      : {}),
    ...(input.confirmDecision
      ? { confirmDecision: input.confirmDecision }
      : {}),
  };

  config.onStreamStart?.(body.conversationId);

  const gate = await checkAccessGates(context);
  if (!gate.ok) {
    return {
      ok: false,
      status: gate.status,
      message: gate.message,
      ...(gate.retryAfter !== undefined ? { retryAfter: gate.retryAfter } : {}),
    };
  }

  const params = config.parseParams(body);
  const {
    system,
    orgAdditionalPrompt,
    overrideModel: dbOverrideModel,
  } = await buildSystemPromptForRequest(context, config, params);
  const buffer = await loadOrInitConversation(
    context.models.aiConversations,
    body.conversationId,
    context.userId,
    config.agentType,
  );

  // No SSE sink — keep the streamed-at timestamp fresh (so stale-stream
  // detection matches the HTTP path) and collect experiment-card events.
  const experimentCardIds: string[] = [];
  const emit: AgentEmit = (event, data) => {
    buffer.touchStreamedAt();
    if (event === "experiment-card" && data && typeof data === "object") {
      const id = (data as { experimentId?: unknown }).experimentId;
      if (typeof id === "string" && id && !experimentCardIds.includes(id)) {
        experimentCardIds.push(id);
      }
    }
  };

  await executeAgentTurn({
    context,
    config,
    body,
    params,
    buffer,
    system,
    isDefaultPrompt: !orgAdditionalPrompt,
    dbOverrideModel,
    emit,
  });

  return {
    ok: true,
    conversationId: buffer.conversationId,
    reply: extractFinalAssistantText(buffer.getMessages()),
    pendingAction: buffer.getPendingAction() ?? null,
    experimentCardIds,
  };
}

/**
 * Transport-agnostic core of a single agent turn, shared between the HTTP
 * handler and the headless runner. Transport coupling (SSE headers, `res.end`,
 * access-gate error responses) lives in the callers.
 */
async function executeAgentTurn<TParams>({
  context,
  config,
  body,
  params,
  buffer,
  system,
  isDefaultPrompt,
  dbOverrideModel,
  emit,
}: {
  context: ReqContext;
  config: AgentConfig<TParams>;
  body: AgentRequestBody;
  params: TParams;
  buffer: ConversationBuffer;
  system: string;
  isDefaultPrompt: boolean;
  dbOverrideModel: AIModel | undefined;
  emit: AgentEmit;
}): Promise<void> {
  const { message } = body;
  const { conversationId } = buffer;

  const storedModel = buffer.getModel() as AIModel | undefined;

  // Resolve the model override. `undefined` falls through to the org's
  // `defaultAIModel` below — which on Cloud is always the hardcoded model.
  //
  // Cloud: continued conversations keep their stored model; new ones fall
  // through to the hardcoded default. `body.model` and `dbOverrideModel`
  // are deliberately ignored — Cloud users cannot pick a model.
  //
  // Self-hosted: continued conversations keep their stored model; on the
  // first turn we honor the user's per-request choice, else the org-level
  // prompt override, else the org default. The model selector is disabled
  // in the UI after the first turn, so `body.model` won't be set on
  // follow-ups in normal usage.
  const overrideModel: AIModel | undefined = IS_CLOUD
    ? storedModel
    : storedModel || body.model || dbOverrideModel;

  const { defaultAIModel } = getAISettingsForOrg(context, false);
  const resolvedModel = overrideModel || defaultAIModel;
  buffer.setModel(resolvedModel);

  const tools = config.buildTools(context, buffer, params, emit);

  const isFirstMessage = buffer.getMessages().length === 0;

  // Deterministic mutation-confirmation gate. If a prior turn parked a
  // pending mutation, act on the user's explicit decision before running
  // the model — the model is never relied upon to confirm or replay it.
  const pendingAction = buffer.getPendingAction();
  const decision =
    typeof body.confirmDecision === "string" ? body.confirmDecision : undefined;
  const actionId =
    typeof body.confirmActionId === "string" ? body.confirmActionId : undefined;
  const isConfirm =
    !!pendingAction && decision === "confirm" && actionId === pendingAction.id;
  const isCancel =
    !!pendingAction &&
    decision === "cancel" &&
    (!actionId || actionId === pendingAction.id);

  // Resolve a parked mutation, if any, BEFORE appending a superseding user
  // message — the replayed call/result pair must directly follow the prior
  // assistant turn. On confirm we dispatch the real call; on cancel or any
  // other message (a supersede) we record a "rejected" result. Either way
  // the model sees an ordinary tool result and continues, agnostic of the
  // gate. A cancel/supersede with a follow-up message lets the model react
  // to the rejection plus the new instruction in the same turn.
  if (pendingAction) {
    await resolvePendingAction(context, buffer, pendingAction, emit, isConfirm);
    buffer.setPendingAction(undefined);
  }

  // A confirm/cancel decision is a control signal, not a chat message — we
  // don't persist a visible "Confirm"/"Cancel" user bubble for it. Any other
  // message (including one that supersedes a pending action) is a normal
  // user turn, appended after the parked action has been resolved.
  if (!isConfirm && !isCancel) {
    const datasourceHint =
      config.injectDatasourceHint && typeof body.datasourceId === "string"
        ? body.datasourceId
        : undefined;
    appendUserMessage(buffer, message, body.currentPage, datasourceHint);
  }
  buffer.setStreaming(true);

  persistConversation(context.models.aiConversations, buffer).catch((err) => {
    logger.error(err, "Failed to persist user message");
  });

  const messagesForLLM = toModelMessages(buffer.getMessages());

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
      isDefaultPrompt,
      overrideModel,
      tools,
      maxSteps: config.maxSteps,
      abortSignal: abortController.signal,
    });

    await processStream(stream, config, buffer, emit, abortController, () => {
      // A tool just parked a mutation for confirmation: stop the turn
      // deterministically so the model can't continue past the gate. The
      // pending state is persisted below and acted on next turn.
      if (buffer.getPendingAction()) {
        abortController.abort();
      }
      void (async () => {
        if (await checkCancellation()) return;
        await persistConversation(context.models.aiConversations, buffer);
      })().catch((err) => {
        logger.error(err, "Failed to persist intermediate conversation state");
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

    if (!cancelledExternally) {
      await checkCancellation();
    }

    // Persist the final assistant/tool turn BEFORE the caller closes the
    // stream. The HTTP client kicks off syncMessagesFromServer() the instant
    // it sees the SSE stream close, so MongoDB must already hold the final
    // state; the headless caller reads the reply straight off the buffer.
    // persistConversation swallows its own errors, so this never throws.
    if (!cancelledExternally) {
      await persistConversation(context.models.aiConversations, buffer);
    }

    emit("done", {});
  }
}

/**
 * Walk the conversation backwards and return the most recent assistant
 * message's user-visible text (tool-call-only assistant turns are skipped).
 */
function extractFinalAssistantText(messages: AIChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      const text = getMessageText(m).trim();
      if (text) return text;
    }
  }
  return "";
}

// =============================================================================
// Helpers
// =============================================================================

function appendUserMessage(
  buffer: ConversationBuffer,
  message: string,
  currentPage?: string,
  datasourceHint?: string,
): void {
  const userMessage: AIChatMessage = {
    role: "user",
    id: randomUUID(),
    content: message,
    ts: Date.now(),
    // Trim and drop empties so we never persist whitespace-only context.
    ...(currentPage && currentPage.trim()
      ? { currentPage: currentPage.trim() }
      : {}),
    ...(datasourceHint && datasourceHint.trim()
      ? { datasourceHint: datasourceHint.trim() }
      : {}),
  };
  buffer.appendMessages([userMessage]);
}

/**
 * Resolve a parked mutation into a real tool-call/result pair, then leave the
 * model to continue from it. The parked call was dropped from the transcript
 * when it was gated, so this is the only place the call ever lands in history.
 *
 * - `confirmed`: dispatch the exact stored call (no model involvement) and use
 *   the genuine API response as the tool result.
 * - otherwise (cancel, or a superseding message): record a "rejected" result
 *   so the model sees the user declined and can respond / adapt.
 *
 * In both cases we stream the call/result to the UI as a tool step and append
 * a synthetic assistant tool-call + tool-result pair, so the persisted
 * transcript stays valid and the model reads an ordinary tool result on the
 * turn that follows.
 */
async function resolvePendingAction(
  context: ReqContext,
  buffer: ConversationBuffer,
  pendingAction: AIAgentPendingAction,
  emit: AgentEmit,
  confirmed: boolean,
): Promise<void> {
  const toolCallId = randomUUID();
  const args: Record<string, unknown> = {
    method: pendingAction.method,
    path: pendingAction.path,
    ...(pendingAction.query ? { query: pendingAction.query } : {}),
    ...(pendingAction.body !== undefined ? { body: pendingAction.body } : {}),
  };

  emit("tool-call-input", {
    toolCallId,
    toolName: "callApi",
    input: serializeUnknownForSSE(args),
  });

  let result: unknown;
  let isError = false;
  if (confirmed) {
    const dispatchInput: DispatchInput = {
      method: pendingAction.method,
      path: pendingAction.path,
      query: pendingAction.query,
      body: pendingAction.body,
    };
    const dispatched = await dispatchInternal(context, dispatchInput);
    result = dispatched;
    isError = !(dispatched.status >= 200 && dispatched.status < 300);
  } else {
    // Not a tool error — a deliberate user decision. Phrased so the model
    // treats it as a stop signal rather than something to retry.
    result = {
      status: "rejected",
      message:
        "The user reviewed this change and chose not to run it. Do not retry " +
        "it; acknowledge and wait for their next instruction.",
    };
  }

  emit("tool-call-end", {
    toolName: "callApi",
    toolCallId,
    input: serializeUnknownForSSE(args),
    output: serializeUnknownForSSE(result),
  });

  buffer.appendMessages([
    {
      role: "assistant",
      id: randomUUID(),
      ts: Date.now(),
      content: [{ type: "tool-call", toolCallId, toolName: "callApi", args }],
    },
    {
      role: "tool",
      id: randomUUID(),
      ts: Date.now(),
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName: "callApi",
          result: stringifyToolResultForStorage(result),
          ...(isError ? { isError: true } : {}),
        },
      ],
    },
  ]);
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
