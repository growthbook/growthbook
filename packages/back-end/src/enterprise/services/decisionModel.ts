import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  QualityDecisionAnswer,
  QualityDecisionVerdicts,
  buildQualityDecisionRequest,
  interpretQualityDecisions,
} from "shared/enterprise";
import { TYPESAFE_API_KEY, TYPESAFE_BASE_URL } from "back-end/src/util/secrets";

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

// Judges the built-in AI quality checks with one decision-model request
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
    ),
    inputTokens: response.usage.input_tokens ?? 0,
  };
}
