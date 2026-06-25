import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";
import { aiEditJobStore } from "./aiTools/clientJob";

// Resume endpoint for the AI edit streaming protocol. The /edit
// handler yields a `{ kind: "tool-call", jobId, callId, tool, args }`
// response when a DOM-side tool needs data from the user's browser.
// The extension runs the tool locally and POSTs the result here. We
// resolve the pending tool's awaiter, the LLM resumes, and we race
// again until either another tool yields or the LLM produces its
// final structured output.

const bodySchema = z
  .object({
    jobId: z.string().min(1).max(100),
    callId: z.string().min(1).max(100),
    // Tool results are tool-specific JSON. The Zod schema is just
    // "any object" — we trust the extension's content script handlers
    // to produce shapes the tool's contract expects. A bad shape will
    // cause the model to error gracefully on the next step.
    result: z.unknown(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/edit/resume",
  operationId: "postVisualEditorAIEditResume",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postAIEditResume = createApiRequestHandler(validation)(async (
  req,
) => {
  const context = req.context;
  requireUserAuth(context);

  const { jobId, callId, result } = req.body;

  const job = aiEditJobStore.get(jobId);
  if (!job) {
    // Common cause: the in-memory job was swept by the TTL (5 minutes
    // since last activity) or the back-end instance restarted. On
    // multi-instance deploys, this also fires when the resume request
    // hit a different instance than /edit. Surface a clean error so
    // the side panel can offer the user a "start over" affordance.
    throw new Error(
      "AI edit session not found. It may have timed out or another instance is handling it — start the prompt again.",
    );
  }

  const accepted = job.resolvePendingToolCall(callId, result);
  if (!accepted) {
    throw new Error(
      "Tool call id mismatch — the result doesn't match the call we were waiting on.",
    );
  }

  const outcome = await job.race();

  if (outcome.kind === "error") {
    aiEditJobStore.delete(jobId);
    throw new Error(outcome.error);
  }
  if (outcome.kind === "toolCall") {
    return {
      kind: "tool-call" as const,
      jobId,
      callId: outcome.callId,
      tool: outcome.tool,
      args: outcome.args,
    };
  }

  // outcome.kind === "final" — run the same finalize() the /edit
  // handler attached to the job (validate selectors, retry, sanitize).
  const finalize = (
    job as unknown as {
      finalize: ((raw: unknown) => Promise<unknown>) | null;
    }
  ).finalize;
  let finalized: unknown;
  if (finalize) {
    try {
      finalized = await finalize(outcome.payload);
    } catch (e) {
      logger.warn(
        { err: e, jobId },
        "[visual-editor-ai/edit/resume] finalize failed",
      );
      finalized = outcome.payload;
    }
  } else {
    finalized = outcome.payload;
  }
  aiEditJobStore.delete(jobId);
  return { kind: "final" as const, payload: finalized };
});
