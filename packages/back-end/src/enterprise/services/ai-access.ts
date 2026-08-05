import type { Response } from "express";
import type { AIModel } from "shared/ai";
import type { ReqContext } from "back-end/types/request";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { secondsUntilAICanBeUsedAgainForModel } from "back-end/src/enterprise/services/ai";
import type { AgentConfig } from "back-end/src/enterprise/services/agent-handler";

type OrgAIPromptConfig = Awaited<
  ReturnType<ReqContext["models"]["aiPrompts"]["getAIPrompt"]>
>;

/**
 * Runs the checks that don't depend on which model the request will use:
 * premium feature and AI-enabled. Returns false (and writes an error response)
 * if the request should be rejected.
 *
 * The usage cap is deliberately *not* checked here — it is provider-exact, so it
 * can only be evaluated once the model is resolved. Call `enforceAIUsageCap`
 * with that model.
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

  const { aiEnabled } = await getAISettingsForOrg(context);
  if (!aiEnabled) {
    res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
    return false;
  }

  return true;
}

/**
 * Enforces the Cloud daily token cap for a request that will run `model`.
 * Returns false (and writes a 429) if the org is over its cap.
 *
 * Split from `runAccessGates` because the exemption is per provider: an org that
 * brought its own Anthropic key is exempt on Claude models but still capped on a
 * managed OpenAI one, so this can only run once the model is known.
 */
export async function enforceAIUsageCap(
  context: ReqContext,
  res: Response,
  model: AIModel,
): Promise<boolean> {
  const secondsUntilReset = await secondsUntilAICanBeUsedAgainForModel(
    context,
    model,
  );
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
