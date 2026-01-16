import { generateText, embed, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  encoding_for_model,
  get_encoding,
  TiktokenModel,
} from "@dqbd/tiktoken";
import {
  AIModel,
  AIPromptType,
  getProviderFromModel,
  getProviderFromEmbeddingModel,
} from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { OrganizationInterface } from "shared/types/organization";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";
import { ApiReqContext } from "back-end/types/api";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { logCloudAIUsage } from "back-end/src/services/clickhouse";
import { IS_CLOUD } from "back-end/src/util/secrets";

export const getAIProviderClass = (
  context: ReqContext | ApiReqContext,
  model: AIModel,
):
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createXai>
  | ReturnType<typeof createMistral>
  | ReturnType<typeof createGoogleGenerativeAI> => {
  const {
    aiEnabled,
    openAIAPIKey,
    anthropicAPIKey,
    xaiAPIKey,
    mistralAPIKey,
    googleAPIKey,
  } = getAISettingsForOrg(context, true);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization.");
  }

  const selectedProvider = getProviderFromModel(model);

  if (selectedProvider === "anthropic") {
    if (!anthropicAPIKey) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    return createAnthropic({
      apiKey: anthropicAPIKey,
    });
  } else if (selectedProvider === "xai") {
    if (!xaiAPIKey) {
      throw new Error("XAI_API_KEY is not set.");
    }
    return createXai({
      apiKey: xaiAPIKey,
    });
  } else if (selectedProvider === "mistral") {
    if (!mistralAPIKey) {
      throw new Error("MISTRAL_API_KEY is not set.");
    }
    return createMistral({
      apiKey: mistralAPIKey,
    });
  } else if (selectedProvider === "google") {
    if (!googleAPIKey) {
      throw new Error("GOOGLE_AI_API_KEY is not set.");
    }
    return createGoogleGenerativeAI({
      apiKey: googleAPIKey,
    });
  } else {
    if (!openAIAPIKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }
    return createOpenAI({
      apiKey: openAIAPIKey,
    });
  }
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
  model: AIModel,
) => {
  logger.warn("Calculating token usage from messages as fallback");
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
  overrideModel?: AIModel;
}) => {
  const { defaultAIModel } = getAISettingsForOrg(context, true);

  const model = overrideModel || defaultAIModel;

  const aiProvider = getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  const messages = constructMessages(prompt, instructions);

  const generateOptions = {
    model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
    messages,
    ...(temperature != null ? { temperature } : {}),
  };

  let numTokensUsed: number | undefined;
  let inputTokensUsed: number | undefined;
  let outputTokensUsed: number | undefined;
  let result: string;

  if (returnType === "json" && jsonSchema) {
    const objectResponse = await generateText({
      ...generateOptions,
      output: Output.object({
        schema: jsonSchema,
      }),
    });
    numTokensUsed = objectResponse.usage?.totalTokens;
    result = JSON.stringify(objectResponse.output);
    inputTokensUsed = objectResponse.usage?.inputTokens;
    outputTokensUsed = objectResponse.usage?.outputTokens;
  } else {
    const textResponse = await generateText(generateOptions);
    numTokensUsed = textResponse.usage?.totalTokens;
    result = textResponse.text;
    inputTokensUsed = textResponse.usage?.inputTokens;
    outputTokensUsed = textResponse.usage?.outputTokens;
  }

  if (IS_CLOUD) {
    if (!numTokensUsed) {
      numTokensUsed = numTokensFromMessages(messages, model);
    }
    await updateTokenUsage({ numTokensUsed, organization: context.org });

    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model,
      numPromptTokensUsed: inputTokensUsed,
      numCompletionTokensUsed: outputTokensUsed,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
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
  overrideModel,
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
  overrideModel?: AIModel;
}): Promise<z.infer<T>> => {
  const { defaultAIModel } = getAISettingsForOrg(context, true);
  const model = overrideModel || defaultAIModel;

  const aiProvider = getAIProviderClass(context, model);

  if (aiProvider == null) {
    throw new Error("AI provider not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructMessages(prompt, instructions);

  const response = await generateText({
    model: aiProvider(model) as Parameters<typeof generateText>[0]["model"],
    messages: messages,
    output: Output.object({
      schema: zodObjectSchema,
    }),
    ...(temperature != null ? { temperature } : {}),
  });

  if (IS_CLOUD) {
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model: model,
      numPromptTokensUsed: response.usage?.inputTokens,
      numCompletionTokensUsed: response.usage?.outputTokens,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });

    const numTokensUsed =
      response.usage?.totalTokens ?? numTokensFromMessages(messages, model);
    await updateTokenUsage({ numTokensUsed, organization: context.org });
  }

  if (!response.output) {
    throw new Error("No output returned from AI API.");
  }
  return response.output as z.infer<T>;
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
  const {
    aiEnabled,
    openAIAPIKey,
    mistralAPIKey,
    googleAPIKey,
    embeddingModel,
  } = getAISettingsForOrg(context, true);

  if (!aiEnabled) {
    throw new Error("AI features are not enabled");
  }

  // Get the provider for this embedding model
  const provider = getProviderFromEmbeddingModel(embeddingModel);

  // Check that we have the API key for this provider
  let aiProvider;
  if (provider === "openai") {
    if (!openAIAPIKey) {
      throw new Error("OpenAI API key not set");
    }
    aiProvider = createOpenAI({
      apiKey: openAIAPIKey,
    });
  } else if (provider === "mistral") {
    if (!mistralAPIKey) {
      throw new Error("Mistral API key not set");
    }
    aiProvider = createMistral({
      apiKey: mistralAPIKey,
    });
  } else if (provider === "google") {
    if (!googleAPIKey) {
      throw new Error("Google AI API key not set");
    }
    aiProvider = createGoogleGenerativeAI({
      apiKey: googleAPIKey,
    });
  } else {
    throw new Error(`Unsupported embedding provider: ${provider}`);
  }

  try {
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
