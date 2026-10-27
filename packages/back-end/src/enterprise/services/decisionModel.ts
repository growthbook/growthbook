import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  QualityDecisionAnswer,
  QualityDecisionVerdicts,
  buildCustomCheckJudgeRequest,
  buildQualityDecisionRequest,
  interpretCustomCheckJudge,
  interpretQualityDecisions,
} from "shared/enterprise";
import { CustomQualityCheckJudge } from "shared/validators";
import { TYPESAFE_API_KEY, TYPESAFE_BASE_URL } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

// Pinned, so answers and thresholds don't shift when TypeSafe moves its
// jev-latest alias
export const QUALITY_DECISION_MODEL = "jev-1.13.0";

let client: TypeSafeClient | null = null;

export function isDecisionModelConfigured(): boolean {
  return !!TYPESAFE_API_KEY;
}

function getClient(): TypeSafeClient {
  if (!TYPESAFE_API_KEY) {
    throw new Error("Set TYPESAFE_API_KEY to use decision models");
  }
  client ??= new TypeSafeClient({
    apiKey: TYPESAFE_API_KEY,
    ...(TYPESAFE_BASE_URL ? { baseURL: TYPESAFE_BASE_URL } : {}),
  });
  return client;
}

// Judges the built-in AI quality checks and routed custom rules with one
// decision-model request
export async function judgeQualityWithDecisionModel(
  input: Parameters<typeof buildQualityDecisionRequest>[0],
): Promise<{ verdicts: QualityDecisionVerdicts; inputTokens: number }> {
  const response = await getClient().systemOne({
    model: QUALITY_DECISION_MODEL,
    ...buildQualityDecisionRequest(input),
  });
  return {
    verdicts: interpretQualityDecisions(
      response.answers as Record<string, QualityDecisionAnswer>,
      {
        builtInChecks: input.builtInChecks,
        customKeys: input.customChecks?.map((c) => c.key),
      },
    ),
    inputTokens: response.usage.input_tokens ?? 0,
  };
}

// Which model should judge a custom rule; the chat model when unsure or
// when no decision model is configured
export async function classifyCustomCheckJudge(
  rule: string,
): Promise<CustomQualityCheckJudge> {
  if (!isDecisionModelConfigured()) return "llm";
  try {
    const response = await getClient().systemOne({
      model: QUALITY_DECISION_MODEL,
      ...buildCustomCheckJudgeRequest(rule),
    });
    return interpretCustomCheckJudge(
      response.answers.judge as QualityDecisionAnswer | undefined,
    );
  } catch (e) {
    logger.warn(e, "Couldn't classify a custom quality check");
    return "llm";
  }
}
