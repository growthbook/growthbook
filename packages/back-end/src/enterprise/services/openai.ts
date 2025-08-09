import { OpenAI } from "openai";
import {
  ResponseFormatJSONObject,
  ResponseFormatJSONSchema,
  ResponseFormatText,
} from "openai/resources/shared";
import {
  encoding_for_model,
  get_encoding,
  TiktokenModel,
} from "@dqbd/tiktoken";
import { AIPromptType } from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { logger } from "back-end/src/util/logger";
import { OrganizationInterface } from "back-end/types/organization";
import { ReqContext } from "back-end/types/request";
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
  let _openai: OpenAI | null = null;
  if (openAIAPIKey && aiEnabled) {
    _openai = new OpenAI({
      apiKey: openAIAPIKey || "",
    });
  }
  const _openAIModel: TiktokenModel = openAIDefaultModel || "gpt-4o-mini";
  return { client: _openai, model: _openAIModel };
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
  jsonSchema?: ResponseFormatJSONSchema.JSONSchema;
}) => {
  const { client: openai, model } = getOpenAI(context);

  if (openai == null) {
    throw new Error("OpenAI not enabled or key not set");
  }
  // Content moderation check
  const moderationResponse = await openai.moderations.create({ input: prompt });
  if (moderationResponse.results.some((r) => r.flagged)) {
    throw new Error("Prompt was flagged by OpenAI moderation");
  }

  const messages = constructOpenAIMessages(prompt, instructions);

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

  // adjust the model if they change what models support json_schema
  const response_format:
    | ResponseFormatText
    | ResponseFormatJSONSchema
    | ResponseFormatJSONObject =
    jsonSchema && supportsJSONSchema(model)
      ? { type: "json_schema", json_schema: jsonSchema }
      : returnType === "json"
        ? { type: "json_object" }
        : { type: "text" };
  const response = await openai.chat.completions.create({
    model,
    messages,
    response_format,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = response.usage?.total_tokens ?? numTokens;

  // Fire and forget
  logCloudAIUsage({
    organization: context.org.id,
    type,
    model,
    numPromptTokensUsed: response.usage?.prompt_tokens ?? 0,
    numCompletionTokensUsed: response.usage?.completion_tokens ?? 0,
    temperature,
    usedDefaultPrompt: isDefaultPrompt,
  });

  await updateTokenUsage({ numTokensUsed, organization: context.org });

  return response.choices[0].message?.content || "";
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
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
}): Promise<z.infer<T>> => {
  const { client: openai, model } = getOpenAI(context);

  if (openai == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt.",
    );
  }

  const messages = constructOpenAIMessages(prompt, instructions);

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

  const response_format:
    | ResponseFormatText
    | ResponseFormatJSONSchema
    | ResponseFormatJSONObject = zodResponseFormat(
    zodObjectSchema,
    "response_schema",
  );
  if (!supportsJSONSchema(model) && response_format.type === "json_schema") {
    throw new Error(
      `Model ${model} does not support JSON schema response format. Please use a model that supports it, such as gpt-4o or higher.`,
    );
  }

  const response = await openai.chat.completions.parse({
    model,
    messages,
    response_format,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = response.usage?.total_tokens ?? numTokens;

  // Fire and forget
  logCloudAIUsage({
    organization: context.org.id,
    type,
    model,
    numPromptTokensUsed: response.usage?.prompt_tokens ?? 0,
    numCompletionTokensUsed: response.usage?.completion_tokens ?? 0,
    temperature,
    usedDefaultPrompt: isDefaultPrompt,
  });

  await updateTokenUsage({ numTokensUsed, organization: context.org });

  if (
    !response.choices ||
    response.choices.length === 0 ||
    !response.choices[0]?.message?.parsed
  ) {
    throw new Error("No choices returned from OpenAI API.");
  }
  return response.choices[0].message.parsed as z.infer<T>;
};

export const supportsJSONSchema = (model: TiktokenModel) => {
  return (
    /^gpt-(\d+(\.\d+)?)o/.test(model) &&
    parseFloat(model.match(/^gpt-(\d+(\.\d+)?)o/)?.[1] ?? "0") >= 4
  );
};

const constructOpenAIMessages = (
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

export const generateEmbeddings = async ({
  context,
  input,
}: {
  context: ReqContext | ApiReqContext;
  input: string[];
}) => {
  const { client: openai } = getOpenAI(context);

  if (openai == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  if (!input) {
    throw new Error("No input provided for embeddings generation.");
  }

  try {
    const { data } = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });
    return data;
  } catch (error) {
    throw new Error("Failed to generate embeddings: " + error);
  }
};

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must be of the same length");
  }
  const dot = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const normA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}
