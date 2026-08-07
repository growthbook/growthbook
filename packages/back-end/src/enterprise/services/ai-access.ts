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

// Model-independent checks: premium feature and AI-enabled. Writes the error
// response and returns false if the request should be rejected. The usage cap is
// provider-exact, so it lives in enforceAIUsageCap once the model is known.
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

// Cloud daily cap for a request that will run `model`; writes a 429 and returns
// false when over. Split out because the exemption is per provider: a BYOK
// Anthropic key doesn't exempt a managed OpenAI model.
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
