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
 * Result of the AI access checks. `ok: false` carries the HTTP-style status
 * and message a transport should surface (SSE writes it to `res`; the headless
 * runner returns it to its caller).
 */
export type AccessGateResult =
  | { ok: true }
  | { ok: false; status: number; message: string; retryAfter?: number };

/**
 * Pure premium-feature, AI-enabled, and rate-limit checks. No transport
 * coupling — callers decide how to surface a denial.
 */
export async function checkAccessGates(
  context: ReqContext,
): Promise<AccessGateResult> {
  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    return {
      ok: false,
      status: 403,
      message: "Your plan does not support AI features.",
    };
  }

  const { aiEnabled } = getAISettingsForOrg(context);
  if (!aiEnabled) {
    return {
      ok: false,
      status: 404,
      message: "AI configuration not set or enabled",
    };
  }

  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
  if (secondsUntilReset > 0) {
    return {
      ok: false,
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    };
  }

  return { ok: true };
}

/**
 * Runs the access gates and writes an error response if the request should be
 * rejected. Returns false when rejected. Thin SSE/HTTP wrapper over
 * {@link checkAccessGates}.
 */
export async function runAccessGates(
  context: ReqContext,
  res: Response,
): Promise<boolean> {
  const result = await checkAccessGates(context);
  if (result.ok) return true;

  res.status(result.status).json({
    status: result.status,
    message: result.message,
    ...(result.retryAfter !== undefined
      ? { retryAfter: result.retryAfter }
      : {}),
  });
  return false;
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
