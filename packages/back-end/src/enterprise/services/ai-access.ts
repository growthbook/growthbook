import type { Response } from "express";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { secondsUntilAICanBeUsedAgain } from "back-end/src/enterprise/services/ai";
import { NotFoundError, PlanDoesNotAllowError } from "back-end/src/util/errors";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";

type OrgAIPromptConfig = Awaited<
  ReturnType<ReqContext["models"]["aiPrompts"]["getAIPrompt"]>
>;

// Thrown when the org is over its AI usage limit. `status` is read by the
// external API handler to set a 429; `retryAfter` is surfaced to callers.
export class AIUsageLimitError extends Error {
  status = 429;
  constructor(public retryAfter: number) {
    super("Over AI usage limits");
  }
}

/**
 * Premium-feature, AI-enabled, and rate-limit checks. Throws on the first
 * failed gate. Shared by every AI entry point so they enforce the same
 * limits — call this (not just a plan-flag check) before any AI/embedding
 * work, including from external API handlers.
 */
export async function assertAIAccess(context: ReqContext): Promise<void> {
  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    throw new PlanDoesNotAllowError("Your plan does not support AI features.");
  }

  const { aiEnabled } = getAISettingsForOrg(context);
  if (!aiEnabled) {
    throw new NotFoundError("AI configuration not set or enabled");
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    throw new AIUsageLimitError(secondsUntilReset);
  }
}

/**
 * Express-controller wrapper around assertAIAccess. Returns false (and writes
 * the matching error response) if the request should be rejected.
 */
export async function runAccessGates(
  context: ReqContext,
  res: Response,
): Promise<boolean> {
  try {
    await assertAIAccess(context);
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
