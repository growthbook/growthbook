import type { Response } from "express";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { secondsUntilAICanBeUsedAgain } from "back-end/src/enterprise/services/ai";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";

type OrgAIPromptConfig = Awaited<
  ReturnType<ReqContext["models"]["aiPrompts"]["getAIPrompt"]>
>;

/**
 * Runs premium-feature, AI-enabled, and rate-limit checks.
 * Returns false (and writes an error response) if the request should be rejected.
 */
export async function runAccessGates(
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
