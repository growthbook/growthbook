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

export type AIUsageTarget = { model?: AIModel } | { embeddings: true };

export class AIUsageLimitError extends Error {
  status = 429;
  constructor(public retryAfter: number) {
    super("Over AI usage limits");
  }
}

async function assertAIEnabled(context: ReqContext): Promise<void> {
  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    throw new PlanDoesNotAllowError("Your plan does not support AI features.");
  }

  const { aiEnabled } = await getAISettingsForOrg(context);
  if (!aiEnabled) {
    throw new NotFoundError("AI configuration not set or enabled");
  }
}

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

export async function assertAIAccess(
  context: ReqContext,
  target: AIUsageTarget = {},
): Promise<void> {
  await assertAIEnabled(context);
  await assertAIUsageCap(context, target);
}

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

export async function runAccessGates(
  context: ReqContext,
  res: Response,
  target: AIUsageTarget = {},
): Promise<boolean> {
  return runGate(res, () => assertAIAccess(context, target));
}

export async function runAIEnabledGates(
  context: ReqContext,
  res: Response,
): Promise<boolean> {
  return runGate(res, () => assertAIEnabled(context));
}

export async function enforceAIUsageCap(
  context: ReqContext,
  res: Response,
  model: AIModel,
): Promise<boolean> {
  return runGate(res, () => assertAIUsageCap(context, { model }));
}

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
