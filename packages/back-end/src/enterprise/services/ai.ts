/**
 * Generic AI Service for GrowthBook
 *
 * This service provides a unified interface for multiple AI providers using Vercel's AI SDK.
 * Currently supports: OpenAI, Anthropic
 *
 * To add a new provider:
 * 1. Install the provider SDK: `yarn add @ai-sdk/[provider]`
 * 2. Add provider type to AIProvider union type
 * 3. Add provider creation logic in getAIProvider()
 * 4. Add environment variable handling in getAISettingsForOrg()
 * 5. Update organization.d.ts types if needed
 *
 * Example: Adding Google AI
 * - `yarn add @ai-sdk/google`
 * - Add "google" to AIProvider type
 * - Add createGoogle() call in getAIProvider()
 * - Add GOOGLE_API_KEY handling
 */

import { generateText, generateObject, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  encoding_for_model,
  get_encoding,
  TiktokenModel,
} from "@dqbd/tiktoken";
import { AIPromptType, AIProvider, AI_PROVIDER_MODEL_MAP } from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { OrganizationInterface } from "back-end/types/organization";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";
import { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logCloudAIUsage } from "back-end/src/services/clickhouse";
import { IS_CLOUD } from "back-end/src/util/secrets";

// Helper function to get available providers based on API keys
export function getAvailableAIProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.ANTHROPIC_API_KEY) providers.push("anthropic");
  return providers;
}

// Helper function to validate provider configuration
export function validateAIProvider(provider: AIProvider): boolean {
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  return false;
}

// Get all available models grouped by provider
export function getAvailableAIModels(): Record<AIProvider, string[]> {
  const availableProviders = getAvailableAIProviders();
  const result: Partial<Record<AIProvider, string[]>> = {};

  availableProviders.forEach((provider) => {
    result[provider] = AI_PROVIDER_MODEL_MAP[provider];
  });

  return result as Record<AIProvider, string[]>;
}

// Get models for a specific provider
export function getModelsForProvider(provider: AIProvider): string[] {
  return AI_PROVIDER_MODEL_MAP[provider] || [];
}

// Determine provider from model name
export function getProviderFromModel(model: string): AIProvider | null {
  for (const [provider, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    if (models.includes(model as never)) {
      return provider as AIProvider;
    }
  }
  return null;
}

export const getAIProvider = (
  context: ReqContext | ApiReqContext,
  overrideModel?: string,
): {
  provider:
    | ReturnType<typeof createAnthropic>
    | ReturnType<typeof createOpenAI>
    | null;
  model: string;
} => {
  const { aiEnabled, openAIAPIKey, anthropicAPIKey, defaultAIModel } =
    getAISettingsForOrg(context, true);

  // Determine the model to use (override > default)
  const modelToUse = overrideModel || defaultAIModel;

  let selectedProvider = null;

  for (const [provider, models] of Object.entries(AI_PROVIDER_MODEL_MAP)) {
    if (models.includes(modelToUse as never)) {
      selectedProvider = provider as AIProvider;
      break;
    }
  }
  if (!selectedProvider) {
    throw new Error(`Model ${modelToUse} is not supported.`);
  }

  if (!aiEnabled) {
    return {
      provider: null,
      model: modelToUse,
    };
  }

  let provider = null;
  if (selectedProvider === "anthropic" && anthropicAPIKey) {
    provider = createAnthropic({
      apiKey: anthropicAPIKey,
    });
  } else if (selectedProvider === "openai" && openAIAPIKey) {
    provider = createOpenAI({
      apiKey: openAIAPIKey,
    });
  }

  return {
    provider,
    model: modelToUse,
  };
};

type ChatCompletionRequestMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * The docs say OpenAI might not always return token usage info in rare edge cases.
 * So this is a fallback, so we can keep track of token usage on cloud regardless.
 */
const numTokensFromMessages = (
  messages: ChatCompletionRequestMessage[],
  context: ReqContext | ApiReqContext,
) => {
  const { model } = getAIProvider(context);

  // Use tiktoken for OpenAI models
  let encoding;
  try {
    encoding = encoding_for_model(model as TiktokenModel);
  } catch (e) {
    logger.warn(`services/ai - Could not find encoding for model: ${model}`);
    encoding = get_encoding("cl100k_base");
  }

  let numTokens = 0;
  for (const message of messages) {
    numTokens += 4;
    for (const [key, value] of Object.entries(message)) {
      numTokens += encoding.encode(value as string).length;
      if (key === "name") numTokens -= 1;
    }
  }

  numTokens += 2;

  return numTokens;
};

export const secondsUntilAICanBeUsedAgain = async (
  organization: OrganizationInterface,
) => {
  const { numTokensUsed, dailyLimit, nextResetAt } =
    await getTokensUsedByOrganization(organization);
  return numTokensUsed > dailyLimit
    ? (nextResetAt - new Date().getTime()) / 1000
    : 0;
};

const constructMessages = (
  prompt: string,
  instructions?: string,
): ChatCompletionRequestMessage[] => {
  const messages: ChatCompletionRequestMessage[] = [];

  if (instructions) {
    messages.push({
      role: "system",
      content: instructions,
    });
  }

  messages.push({
    role: "user",
    content: prompt,
  });

  return messages;
};

export const simpleCompletion = async ({
  context,
  instructions,
  prompt,
  temperature,
  type,
  isDefaultPrompt,
  returnType = "text",
  jsonSchema,
  overrideModel,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  returnType?: "text" | "json";
  jsonSchema?: ZodObject<ZodRawShape>;
  overrideModel?: string;
}) => {
  const { provider: aiProvider, model } = getAIProvider(context, overrideModel);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  const messages = constructMessages(prompt, instructions);

  const generateOptions = {
    model: aiProvider(model),
    messages,
    ...(temperature != null ? { temperature } : {}),
  };

  let numTokensUsed: number | undefined;
  let result: string;

  if (returnType === "json" && jsonSchema) {
    const objectResponse = await generateObject({
      ...generateOptions,
      schema: jsonSchema,
    });
    numTokensUsed = objectResponse.usage?.totalTokens;
    result = JSON.stringify(objectResponse.object);
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      numPromptTokensUsed: objectResponse.usage?.inputTokens,
      numCompletionTokensUsed: objectResponse.usage?.outputTokens,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  } else {
    const textResponse = await generateText(generateOptions);
    numTokensUsed = textResponse.usage?.totalTokens;
    result = textResponse.text;
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      numPromptTokensUsed: textResponse.usage?.inputTokens,
      numCompletionTokensUsed: textResponse.usage?.outputTokens,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  }

  if (IS_CLOUD) {
    if (!numTokensUsed) {
      numTokensUsed = numTokensFromMessages(messages, context);
    }
    await updateTokenUsage({ numTokensUsed, organization: context.org });
  }

  return result;
};

export const parsePrompt = async <T extends ZodObject<ZodRawShape>>({
  context,
  instructions,
  prompt,
  temperature,
  type,
  isDefaultPrompt,
  zodObjectSchema,
  model,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
  model?: string;
}): Promise<z.infer<T>> => {
  const { provider: aiProvider, model: defaultModel } = getAIProvider(
    context,
    model,
  );

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructMessages(prompt, instructions);

  const modelToUse = model || defaultModel;

  // Convert messages to the format expected by Vercel AI SDK
  const coreMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const response = await generateObject({
    model: aiProvider(modelToUse),
    messages: coreMessages,
    schema: zodObjectSchema,
    ...(temperature != null ? { temperature } : {}),
  });

  if (IS_CLOUD) {
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model: modelToUse,
      numPromptTokensUsed: response.usage?.inputTokens,
      numCompletionTokensUsed: response.usage?.outputTokens,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });

    const numTokensUsed =
      response.usage?.totalTokens ?? numTokensFromMessages(messages, context);
    await updateTokenUsage({ numTokensUsed, organization: context.org });
  }

  if (!response.object) {
    throw new Error("No object returned from AI API.");
  }
  return response.object as z.infer<T>;
};

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must be of the same length");
  }
  const dot = vec1.reduce((sum, val, _i) => sum + val * val, 0);
  const normA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

export async function generateEmbeddings({
  context,
  input,
}: {
  context: ReqContext | ApiReqContext;
  input: string[];
}): Promise<number[][]> {
  const { aiEnabled, openAIAPIKey, embeddingModel } = getAISettingsForOrg(
    context,
    true,
  );

  if (!aiEnabled) {
    throw new Error("AI features are not enabled");
  }

  if (!openAIAPIKey) {
    throw new Error("OpenAI API key not set");
  }

  try {
    // Always use OpenAI for embeddings
    const aiProvider = createOpenAI({
      apiKey: openAIAPIKey,
    });

    const model = aiProvider.embedding(embeddingModel);

    // Generate embeddings for each input string
    const embeddings: number[][] = [];

    for (const text of input) {
      const result = await embed({
        model: model,
        value: text,
      });

      embeddings.push(result.embedding);
    }

    return embeddings;
  } catch (error) {
    logger.error("Error generating embeddings:", error);
    throw new Error("Failed to generate embeddings");
  }
}

export function supportsJSONSchema(): boolean {
  return true;
}
