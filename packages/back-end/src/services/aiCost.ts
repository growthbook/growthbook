import { calcPrice } from "@pydantic/genai-prices";
import { getProviderForAIModel } from "shared/ai";
import { logger } from "back-end/src/util/logger";

type LanguageModelUsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

export type AICompletionUsage = {
  // Total input, including cache reads and writes.
  inputTokens?: number;
  // Total output, including reasoning tokens.
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function completionUsageFromSdk(
  usage: LanguageModelUsageLike | undefined,
): AICompletionUsage {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens:
      usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
  };
}

export function addCompletionUsage(
  a: AICompletionUsage,
  b: AICompletionUsage,
): AICompletionUsage {
  const sum = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sum(a.cacheWriteTokens, b.cacheWriteTokens),
  };
}

export function estimateAICompletionUsd(
  model: string,
  usage: AICompletionUsage,
): number | undefined {
  // No reported usage means unknown spend, not zero: an abort before the first
  // step finishes is still billed for the tokens the provider processed.
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return undefined;
  }

  const provider =
    getProviderForAIModel("text", model) ??
    getProviderForAIModel("image", model) ??
    getProviderForAIModel("embedding", model);
  if (!provider) return undefined;

  try {
    const price = calcPrice(
      {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_write_tokens: usage.cacheWriteTokens,
      },
      model,
      { providerId: provider },
    );
    if (!price) {
      logger.warn({ model, provider }, "No genai-prices entry for AI model");
      return undefined;
    }
    return price.total_price;
  } catch (error) {
    logger.warn({ err: error, model }, "Could not estimate AI completion USD");
    return undefined;
  }
}
