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
import {
  TYPESAFE_API_KEY,
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
} from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

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
    ...(TYPESAFE_DEFAULT_MODEL ? { defaultModel: TYPESAFE_DEFAULT_MODEL } : {}),
  });
  return client;
}

// Judges the built-in AI quality checks and routed custom rules with one
// decision-model request
export async function judgeQualityWithDecisionModel(
  input: Parameters<typeof buildQualityDecisionRequest>[0],
): Promise<QualityDecisionVerdicts> {
  const response = await getClient().systemOne({
    ...buildQualityDecisionRequest(input),
  });
  return interpretQualityDecisions(
    response.answers as Record<string, QualityDecisionAnswer>,
    {
      builtInChecks: input.builtInChecks,
      customKeys: input.customChecks?.map((c) => c.key),
    },
  );
}

// Which model should judge a custom rule; the chat model when unsure or
// when no decision model is configured
export async function classifyCustomCheckJudge(
  rule: string,
): Promise<CustomQualityCheckJudge> {
  if (!isDecisionModelConfigured()) return "llm";
  try {
    const response = await getClient().systemOne({
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
