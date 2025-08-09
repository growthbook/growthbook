import { Ollama, ChatResponse } from "ollama";
import { AIPromptType } from "shared/ai";
import { z, ZodObject, ZodRawShape } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ResponseFormatJSONObject,
  ResponseFormatJSONSchema,
  ResponseFormatText,
} from "openai/resources/shared";
import { OrganizationInterface } from "back-end/types/organization";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";
import { logCloudAIUsage } from "back-end/src/services/clickhouse";
import { getAISettingsForOrg } from "back-end/src/services/organizations";

const MODEL_TOKEN_LIMIT = 128000;
const MESSAGE_TOKEN_LIMIT = MODEL_TOKEN_LIMIT - 30;

export const getOllama = (context: ReqContext | ApiReqContext) => {
  const { aiEnabled, ollamaBaseUrl, ollamaDefaultModel } = getAISettingsForOrg(
    context
  );
  let _ollama: Ollama | null = null;
  if (aiEnabled) {
    _ollama = new Ollama({ host: ollamaBaseUrl });
  }
  const _ollamaModel: string = ollamaDefaultModel || "";
  return { client: _ollama, model: _ollamaModel };
};

export const listAvailableModels = async (
  context: ReqContext | ApiReqContext
) => {
  const { client: ollama } = getOllama(context);

  if (ollama == null) {
    throw new Error("Ollama not enabled or key not set");
  }

  const models = await ollama.list();
  return models;
};

type ChatCompletionRequestMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const numTokensFromMessages = (messages: ChatCompletionRequestMessage[]) => {
  let numTokens = 0;
  for (const message of messages) {
    numTokens += 4;
    for (const [key, value] of Object.entries(message)) {
      numTokens += value.length; // Simplified token calculation
      if (key === "name") numTokens -= 1;
    }
  }
  numTokens += 2;
  return numTokens;
};

export const secondsUntilAICanBeUsedAgain = async (
  organization: OrganizationInterface
) => {
  const {
    numTokensUsed,
    dailyLimit,
    nextResetAt,
  } = await getTokensUsedByOrganization(organization);
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
}: {
  context: ReqContext | ApiReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type: AIPromptType;
  isDefaultPrompt: boolean;
}) => {
  const { client: ollama, model } = getOllama(context);

  if (ollama == null) {
    throw new Error("Ollama not enabled or server not set");
  }

  const messages = constructOllamaMessages(prompt, instructions);

  const numTokens = numTokensFromMessages(messages);
  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`
    );
  }
  if (numTokens > MESSAGE_TOKEN_LIMIT) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds MESSAGE_TOKEN_LIMIT (${MESSAGE_TOKEN_LIMIT})`
    );
  }

  const response: ChatResponse = await ollama.chat({
    model,
    messages,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = numTokens; // Placeholder as usage details are not provided

  // Fire and forget
  logCloudAIUsage({
    organization: context.org.id,
    type,
    model,
    numPromptTokensUsed: 0,
    numCompletionTokensUsed: 0,
    temperature,
    usedDefaultPrompt: isDefaultPrompt,
  });

  await updateTokenUsage({ numTokensUsed, organization: context.org });

  return response.message.content || "";
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
  const { client: ollama, model } = getOllama(context);

  if (ollama == null) {
    throw new Error("Ollama not enabled or key not set");
  }

  if (!zodObjectSchema) {
    throw new Error(
      "a Zod Object for the JSON schema is required for structuredPrompt."
    );
  }

  const messages = constructOllamaMessages(prompt, instructions);

  const numTokens = numTokensFromMessages(messages);
  if (maxTokens != null && numTokens > maxTokens) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`
    );
  }
  if (numTokens > MESSAGE_TOKEN_LIMIT) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds MESSAGE_TOKEN_LIMIT (${MESSAGE_TOKEN_LIMIT})`
    );
  }

  const response_format:
    | ResponseFormatText
    | ResponseFormatJSONSchema
    | ResponseFormatJSONObject = zodResponseFormat(
    zodObjectSchema,
    "response_schema"
  );
  if (!supportsJSONSchema(model) && response_format.type === "json_schema") {
    throw new Error(
      `Model ${model} does not support JSON schema response format. Please use a model that supports it, such as gpt-4o or higher.`
    );
  }

  const response = await ollama.chat({
    model,
    messages,
    format: response_format,
    ...(temperature != null ? { temperature } : {}),
  });

  // Fire and forget
  logCloudAIUsage({
    organization: context.org.id,
    type,
    model,
    numPromptTokensUsed: 0,
    numCompletionTokensUsed: 0,
    temperature,
    usedDefaultPrompt: isDefaultPrompt,
  });

  await updateTokenUsage({ numTokensUsed: 0, organization: context.org });

  if (!response.message) {
    throw new Error("No choices returned from Ollama API.");
  }
  return response.message as z.infer<T>;
};

export const supportsJSONSchema = (model: string) => {
  return !!model;
};

const constructOllamaMessages = (
  prompt: string,
  instructions?: string
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
  const { client: ollama } = getOllama(context);

  if (ollama == null) {
    throw new Error("Ollama not enabled or server not set");
  }

  if (!input) {
    throw new Error("No input provided for embeddings generation.");
  }

  try {
    const { embeddings } = await ollama.embed({
      model: "nomic-embed-text",
      input,
    });
    return embeddings.map((embedding) => ({ embedding }));
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
