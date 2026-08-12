import type { Response } from "express";
import type { AIModel } from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  secondsUntilAICanBeUsedAgainForEmbeddings,
  secondsUntilAICanBeUsedAgainForModel,
} from "back-end/src/enterprise/services/ai";
import { NotFoundError, PlanDoesNotAllowError } from "back-end/src/util/errors";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";

type OrgAIPromptConfig = Awaited<
  ReturnType<ReqContext["models"]["aiPrompts"]["getAIPrompt"]>
>;

// What the request is about to spend tokens on. The usage cap is provider-exact,
// so the gate has to know: a BYOK Anthropic key must not exempt a managed OpenAI
// model, and text models say nothing about the embedding provider. `{}` meters
// against the org's default text model.
export type AIUsageTarget = { model?: AIModel } | { embeddings: true };

// Thrown when the org is over its AI usage limit. `status` is read by the
// external API handler to set a 429; `retryAfter` is surfaced to callers.
export class AIUsageLimitError extends Error {
  status = 429;
  constructor(public retryAfter: number) {
    super("Over AI usage limits");
  }
}

// Model-independent gates: premium feature and AI-enabled. Throws on the first
// failure. Only for callers that don't yet know which model they'll run —
// everything else should use assertAIAccess so the usage cap is checked too.
async function assertAIEnabled(context: ReqContext): Promise<void> {
  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    throw new PlanDoesNotAllowError("Your plan does not support AI features.");
  }

  const { aiEnabled } = await getAISettingsForOrg(context);
  if (!aiEnabled) {
    throw new NotFoundError("AI configuration not set or enabled");
  }
}

// Cloud daily cap for what `target` is about to spend, skipped only for a
// provider the org brings its own key for.
async function assertAIUsageCap(
  context: ReqContext,
  target: AIUsageTarget,
): Promise<void> {
  const secondsUntilReset =
    "embeddings" in target
      ? await secondsUntilAICanBeUsedAgainForEmbeddings(context)
      : await secondsUntilAICanBeUsedAgainForModel(context, target.model);
  if (secondsUntilReset > 0) {
    throw new AIUsageLimitError(secondsUntilReset);
  }
}

/**
 * Premium-feature, AI-enabled, and usage-cap checks. Throws on the first
 * failed gate. Shared by every AI entry point so they enforce the same
 * limits — call this (not just a plan-flag check) before any AI/embedding
 * work, including from external API handlers. Pass the model or embedding
 * flag for the work about to run; the cap is provider-exact.
 */
export async function assertAIAccess(
  context: ReqContext,
  target: AIUsageTarget = {},
): Promise<void> {
  await assertAIEnabled(context);
  await assertAIUsageCap(context, target);
}

// Maps a failed gate onto the error response, so every entry point rejects the
// same way. Returns false for `if (!(await ...)) return;` call sites.
async function runGate(
  res: Response,
  gate: () => Promise<void>,
): Promise<boolean> {
  try {
    await gate();
    return true;
  } catch (e) {
    const status =
      e instanceof Error && "status" in e && typeof e.status === "number"
        ? e.status
        : 400;
    res.status(status).json({
      status,
      message: e instanceof Error ? e.message : "AI access denied",
      ...(e instanceof AIUsageLimitError ? { retryAfter: e.retryAfter } : {}),
    });
    return false;
  }
}

/**
 * Express-controller wrapper around assertAIAccess. Returns false (and writes
 * the matching error response) if the request should be rejected.
 */
export async function runAccessGates(
  context: ReqContext,
  res: Response,
  target: AIUsageTarget = {},
): Promise<boolean> {
  return runGate(res, () => assertAIAccess(context, target));
}

// Cap-free half of runAccessGates, for handlers that resolve the model after
// gating (see createAgentHandler): run this first, then enforceAIUsageCap once
// the model is known. Anything that knows its model up front wants
// runAccessGates instead.
export async function runAIEnabledGates(
  context: ReqContext,
  res: Response,
): Promise<boolean> {
  return runGate(res, () => assertAIEnabled(context));
}

// Usage-cap half, for a request that will run `model`. Split out because the
// exemption is per provider: a BYOK Anthropic key doesn't exempt a managed
// OpenAI model, so the cap can only be checked once the model is resolved.
export async function enforceAIUsageCap(
  context: ReqContext,
  res: Response,
  model: AIModel,
): Promise<boolean> {
  return runGate(res, () => assertAIUsageCap(context, { model }));
}

/**
 * Builds the final system prompt by combining the agent's prompt with
 * any org-level additional prompt configured in the DB.
 */
export async function buildSystemPromptForRequest<TParams>(
  context: ReqContext,
  config: Pick<AgentConfig<TParams>, "buildSystemPrompt" | "promptType">,
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
