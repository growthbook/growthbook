/**
 * Generic AI Service for GrowthBook
 *
 * This service provides a unified interface for multiple AI providers using Vercel's AI SDK.
 * Currently supports: OpenAI, Anthropic
 *
 * To add a new provider:
 * 1. Install the provider SDK: `yarn add @ai-sdk/[provider]`
 * 2. Add provider type to AIProvider union type
 * 3. Add configuration to AI_PROVIDER_CONFIGS
 * 4. Add provider creation logic in getAIProvider()
 * 5. Add environment variable handling in getAISettingsForOrg()
 * 6. Update organization.d.ts types if needed
 *
 * Example: Adding Google AI
 * - `yarn add @ai-sdk/google`
 * - Add "google" to AIProvider type
 * - Add google config to AI_PROVIDER_CONFIGS
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
import { AIPromptType } from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { logger } from "back-end/src/util/logger";
import { OrganizationInterface, ReqContext } from "back-end/types/organization";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";
import { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logCloudAIUsage } from "back-end/src/services/clickhouse";

// AI Provider types and configurations
export type AIProvider = "openai" | "anthropic";

export interface AIProviderConfig {
  provider: AIProvider;
  textModel: string;
  embeddingModel?: string;
  maxTokens: number;
  supportsJSON: boolean;
  supportsEmbeddings: boolean;
}

// Available models for each provider
export const AI_MODELS: Record<AIProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ],
};

const AI_PROVIDER_CONFIGS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    provider: "openai",
    textModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-ada-002",
    maxTokens: 128000,
    supportsJSON: true,
    supportsEmbeddings: true,
  },
  anthropic: {
    provider: "anthropic",
    textModel: "claude-3-haiku-20240307",
    embeddingModel: undefined, // Anthropic doesn't have embedding models
    maxTokens: 200000,
    supportsJSON: true,
    supportsEmbeddings: false,
  },
};

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
    result[provider] = AI_MODELS[provider];
  });

  return result as Record<AIProvider, string[]>;
}

// Get models for a specific provider
export function getModelsForProvider(provider: AIProvider): string[] {
  return AI_MODELS[provider] || [];
}

// Require a minimum of 30 tokens for responses.
const getMessageTokenLimit = (provider: AIProvider) =>
  AI_PROVIDER_CONFIGS[provider].maxTokens - 30;

export const getAIProvider = (
  context: ReqContext | ApiReqContext,
  overrideProvider?: AIProvider,
  overrideModel?: string,
) => {
  const {
    aiEnabled,
    aiProvider,
    openAIAPIKey,
    anthropicAPIKey,
    openAIDefaultModel,
    anthropicDefaultModel,
  } = getAISettingsForOrg(context, true);

  // Use override provider if specified, otherwise use org default
  const selectedProvider = overrideProvider || aiProvider;

  if (!aiEnabled) {
    return {
      provider: null,
      model:
        overrideModel ||
        (selectedProvider === "anthropic"
          ? anthropicDefaultModel
          : openAIDefaultModel),
      config: AI_PROVIDER_CONFIGS[selectedProvider],
    };
  }

  let provider = null;
  let model = "";

  if (selectedProvider === "anthropic" && anthropicAPIKey) {
    provider = createAnthropic({
      apiKey: anthropicAPIKey,
    });
    model = overrideModel || anthropicDefaultModel;
  } else if (selectedProvider === "openai" && openAIAPIKey) {
    provider = createOpenAI({
      apiKey: openAIAPIKey,
    });
    model = overrideModel || openAIDefaultModel;
  }

  return {
    provider,
    model,
    config: AI_PROVIDER_CONFIGS[selectedProvider],
  };
};

type ChatCompletionRequestMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Function for counting tokens for messages passed to the model.
 * The exact way that messages are converted into tokens may change from model
 * to model. So when future model versions are released, the answers returned
 * by this function may be only approximate.
 *
 * Note: Token counting is primarily accurate for OpenAI models.
 * For other providers, this provides an approximation.
 */
const numTokensFromMessages = (
  messages: ChatCompletionRequestMessage[],
  context: ReqContext | ApiReqContext,
) => {
  const { config, model } = getAIProvider(context);

  // For non-OpenAI providers, use a rough approximation
  if (config.provider !== "openai") {
    // Rough approximation: ~4 characters per token
    const totalChars = messages.reduce(
      (sum, msg) => sum + JSON.stringify(msg).length,
      0,
    );
    return Math.ceil(totalChars / 4) + messages.length * 4; // Add overhead per message
  }

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
  maxTokens,
  temperature,
  type,
  isDefaultPrompt,
  returnType = "text",
  jsonSchema,
  overrideProvider,
  overrideModel,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  returnType?: "text" | "json";
  jsonSchema?: ZodObject<ZodRawShape>;
  overrideProvider?: AIProvider;
  overrideModel?: string;
}) => {
  const {
    provider: aiProvider,
    model,
    config,
  } = getAIProvider(context, overrideProvider, overrideModel);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  // Check if JSON is supported for this provider
  if (returnType === "json" && !config.supportsJSON) {
    throw new Error(`JSON generation not supported by ${config.provider}`);
  }

  const messages = constructMessages(prompt, instructions);
  const numTokens = numTokensFromMessages(messages, context);
  const messageTokenLimit = getMessageTokenLimit(config.provider);

  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`,
    );
  }
  if (numTokens > messageTokenLimit) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds limit for ${config.provider} (${messageTokenLimit})`,
    );
  }

  const generateOptions = {
    model: aiProvider(model),
    messages,
    ...(temperature != null ? { temperature } : {}),
  };

  let _response;
  let numTokensUsed = numTokens;
  let result: string;

  if (returnType === "json" && jsonSchema) {
    const objectResponse = await generateObject({
      ...generateOptions,
      schema: jsonSchema,
    });
    numTokensUsed = objectResponse.usage?.totalTokens ?? numTokens;
    result = JSON.stringify(objectResponse.object);
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      // numPromptTokensUsed: objectResponse.usage?.promptTokens ?? 0,
      // numCompletionTokensUsed: objectResponse.usage?.completionTokens ?? 0,
      numPromptTokensUsed: 0,
      numCompletionTokensUsed: 0,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  } else {
    const textResponse = await generateText(generateOptions);
    numTokensUsed = textResponse.usage?.totalTokens ?? numTokens;
    result = textResponse.text;
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      // numPromptTokensUsed: textResponse.usage?.promptTokens ?? 0,
      // numCompletionTokensUsed: textResponse.usage?.completionTokens ?? 0,
      numPromptTokensUsed: 0,
      numCompletionTokensUsed: 0,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  }

  await updateTokenUsage({ numTokensUsed, organization: context.org });

  return result;
};

export const parsePrompt = async <T extends ZodObject<ZodRawShape>>({
  context,
  instructions,
  prompt,
  maxTokens,
  temperature,
  type,
  isDefaultPrompt,
  zodObjectSchema,
  model,
  overrideProvider,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
  model?: string;
  overrideProvider?: AIProvider;
}): Promise<z.infer<T>> => {
  const {
    provider: aiProvider,
    model: defaultModel,
    config,
  } = getAIProvider(context, overrideProvider, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  if (!config.supportsJSON) {
    throw new Error(`JSON generation not supported by ${config.provider}`);
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructMessages(prompt, instructions);
  const numTokens = numTokensFromMessages(messages, context);
  const messageTokenLimit = getMessageTokenLimit(config.provider);

  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`,
    );
  }
  if (numTokens > messageTokenLimit) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds limit for ${config.provider} (${messageTokenLimit})`,
    );
  }
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

  const numTokensUsed = response.usage?.totalTokens ?? numTokens;

  // Fire and forget
  logCloudAIUsage({
    organization: context.org.id,
    type,
    model: modelToUse,
    // numPromptTokensUsed: response.usage?.promptTokens ?? 0,
    // numCompletionTokensUsed: response.usage?.completionTokens ?? 0,
    numPromptTokensUsed: 0,
    numCompletionTokensUsed: 0,
    temperature,
    usedDefaultPrompt: isDefaultPrompt,
  });

  await updateTokenUsage({ numTokensUsed, organization: context.org });

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

export async function generateEmbeddings(
  context: ReqContext | ApiReqContext,
  { input }: { input: string[] },
): Promise<number[][]> {
  const { provider: aiProvider, config } = getAIProvider(context);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  if (!config.supportsEmbeddings) {
    throw new Error(`Embeddings not supported by ${config.provider}`);
  }

  if (config.provider !== "openai") {
    throw new Error("Embeddings currently only supported for OpenAI");
  }

  try {
    // Use OpenAI's text-embedding-ada-002 model for embeddings
    const embeddingModel = (
      aiProvider as ReturnType<typeof createOpenAI>
    ).embedding(config.embeddingModel!);

    // Generate embeddings for each input string
    const embeddings: number[][] = [];

    for (const text of input) {
      const result = await embed({
        model: embeddingModel,
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
