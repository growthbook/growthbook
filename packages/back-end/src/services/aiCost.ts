import {
  estimateCompletionUsd,
  findOpenRouterModel,
  getProviderForAIModel,
  parseOpenRouterCatalog,
  type AICompletionUsage,
} from "shared/ai";
import {
  loadOpenRouterCatalogSnapshot,
  saveOpenRouterCatalogSnapshot,
} from "back-end/src/models/AIPriceCatalogModel";
import {
  OPENROUTER_MODELS_URL,
  createOpenRouterCatalogCache,
} from "back-end/src/services/openRouterModelCatalog";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

type LanguageModelUsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
};

async function fetchOpenRouterModels() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    timeout: 20_000,
  });
  if (!res.ok) {
    throw new Error(`OpenRouter models HTTP ${res.status}`);
  }
  const json: unknown = await res.json();
  const models = parseOpenRouterCatalog(json);
  if (models.length === 0) {
    throw new Error("OpenRouter models catalog was empty");
  }
  return models;
}

const catalog = createOpenRouterCatalogCache({
  fetchModels: fetchOpenRouterModels,
  load: loadOpenRouterCatalogSnapshot,
  save: saveOpenRouterCatalogSnapshot,
  onRefreshError: (error) => {
    logger.error(error, "OpenRouter model catalog refresh failed");
  },
});

export function completionUsageFromSdk(
  usage: LanguageModelUsageLike | undefined,
  extra?: Pick<AICompletionUsage, "imageOutputCount" | "imageOutputSize">,
): AICompletionUsage {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    noCacheTokens: usage?.inputTokenDetails?.noCacheTokens,
    cacheReadTokens:
      usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens:
      usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens,
    ...extra,
  };
}

export function addCompletionUsage(
  a: AICompletionUsage,
  b: AICompletionUsage,
): AICompletionUsage {
  const sum = (x?: number, y?: number) =>
    x == null && y == null ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    noCacheTokens: sum(a.noCacheTokens, b.noCacheTokens),
    cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sum(a.cacheWriteTokens, b.cacheWriteTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    imageOutputCount: sum(a.imageOutputCount, b.imageOutputCount),
    imageOutputSize: a.imageOutputSize ?? b.imageOutputSize,
  };
}

export async function estimateAICompletionUsd(
  model: string,
  usage: AICompletionUsage,
): Promise<number | undefined> {
  try {
    const models = await catalog.get();
    const provider =
      getProviderForAIModel("text", model) ??
      getProviderForAIModel("image", model) ??
      getProviderForAIModel("embedding", model);
    if (!provider) return undefined;
    const row = findOpenRouterModel(models, model, provider);
    if (!row) {
      logger.warn({ model }, "No OpenRouter catalog row for AI model");
      return undefined;
    }
    return estimateCompletionUsd(row.pricing, usage);
  } catch (error) {
    logger.warn({ err: error, model }, "Could not estimate AI completion USD");
    return undefined;
  }
}
