import { generateText, generateObject, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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

/**
 * The MODEL_TOKEN_LIMIT is the maximum number of tokens that can be sent to
 * the OpenAI API in a single request. This limit is imposed by OpenAI.
 *
 */
const MODEL_TOKEN_LIMIT = 128000;
// Require a minimum of 30 tokens for responses.
const MESSAGE_TOKEN_LIMIT = MODEL_TOKEN_LIMIT - 30;

export const getOpenAI = (context: ReqContext | ApiReqContext) => {
  const { aiEnabled, openAIAPIKey, openAIDefaultModel } = getAISettingsForOrg(
    context,
    true,
  );

  if (!openAIAPIKey || !aiEnabled) {
    return { provider: null, model: openAIDefaultModel || "gpt-4o-mini" };
  }

  const provider = createOpenAI({
    apiKey: openAIAPIKey,
  });

  const model = openAIDefaultModel || "gpt-4o-mini";
  return { provider, model };
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
 */
const numTokensFromMessages = (
  messages: ChatCompletionRequestMessage[],
  context: ReqContext | ApiReqContext,
) => {
  let encoding;
  try {
    const { model } = getOpenAI(context);
    encoding = encoding_for_model(model);
  } catch (e) {
    logger.warn(`services/openai - Could not find encoding for model`);
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
}) => {
  const { provider: openaiProvider, model } = getOpenAI(context);

  if (openaiProvider == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  const messages = constructMessages(prompt, instructions);
  const numTokens = numTokensFromMessages(messages, context);

  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`,
    );
  }
  if (numTokens > MESSAGE_TOKEN_LIMIT) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds MESSAGE_TOKEN_LIMIT (${MESSAGE_TOKEN_LIMIT})`,
    );
  }

  const generateOptions = {
    model: openaiProvider(model),
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
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
  model?: TiktokenModel;
}): Promise<z.infer<T>> => {
  const { provider: openaiProvider, model: defaultModel } = getOpenAI(context);

  if (openaiProvider == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructMessages(prompt, instructions);

  const numTokens = numTokensFromMessages(messages, context);
  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`,
    );
  }
  if (numTokens > MESSAGE_TOKEN_LIMIT) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds MESSAGE_TOKEN_LIMIT (${MESSAGE_TOKEN_LIMIT})`,
    );
  }
  const modelToUse = model || defaultModel;

  const response = await generateObject({
    model: openaiProvider(modelToUse),
    messages,
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
  const { provider: openaiProvider, model: _model } = getOpenAI(context);

  if (openaiProvider == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  try {
    // Use OpenAI's text-embedding-ada-002 model for embeddings
    const embeddingModel = openaiProvider.embedding("text-embedding-ada-002");

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
