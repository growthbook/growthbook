import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelUsage } from "ai";
import { anthropicStructuredOutputMode, type AIModel } from "shared/ai";
import { ANTHROPIC_API_KEY } from "back-end/src/util/secrets";
import {
  completionUsageFromSdk,
  estimateAICompletionUsd,
} from "back-end/src/services/aiCost";
import { callUsage, type Usage } from "./record";

// The simulated user and the judge call the provider directly, not through
// GrowthBook's AI service, so they don't count against the agent's usage.
export function evalModel(model: AIModel) {
  const structuredOutputMode = anthropicStructuredOutputMode(model);
  if (!structuredOutputMode) {
    throw new Error(`The simulator and judge run on Claude; ${model} isn't.`);
  }
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to packages/back-end/.env.local or export it.",
    );
  }
  return {
    model: createAnthropic({ apiKey: ANTHROPIC_API_KEY })(model),
    providerOptions: { anthropic: { structuredOutputMode } },
  };
}

export function usageOf(model: AIModel, usage: LanguageModelUsage): Usage {
  const tokens = completionUsageFromSdk(usage);
  return callUsage(
    tokens.inputTokens,
    tokens.outputTokens,
    estimateAICompletionUsd(model, tokens),
  );
}
