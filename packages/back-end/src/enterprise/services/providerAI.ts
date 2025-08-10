import { TiktokenModel } from "@dqbd/tiktoken";
import type { ZodObject, ZodRawShape } from "zod";
import { z } from "zod";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
import {
  simpleCompletion as openaiCompletion,
  secondsUntilAICanBeUsedAgain as openaiSecondsUntilAICanBeUsedAgain,
  parsePrompt as openaiParsePrompt,
  supportsJSONSchema as supportsJSONSchemaOpenAI,
  generateEmbeddings as generateEmbeddingsOpenAI,
} from "./openai";
import {
  simpleCompletion as ollamaCompletion,
  secondsUntilAICanBeUsedAgain as ollamaSecondsUntilAICanBeUsedAgain,
  parsePrompt as ollamaParsePrompt,
  supportsJSONSchema as supportsJSONSchemaOllama,
  generateEmbeddings as generateEmbeddingsOllama,
} from "./ollama";

export const secondsUntilAICanBeUsedAgain = async (context: ReqContext) => {
  const { aiEnabled, aiProvider } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization.");
  }

  const organization = context.org;

  if (aiProvider === "openai") {
    return openaiSecondsUntilAICanBeUsedAgain(organization);
  } else if (aiProvider === "ollama") {
    return ollamaSecondsUntilAICanBeUsedAgain(organization);
  } else {
    throw new Error("No valid AI provider configured.");
  }
};

interface JSONSchema {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

export const simpleCompletion = async (params: {
  context: ReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type:
    | "experiment-analysis"
    | "metric-description"
    | "experiment-hypothesis"
    | "generate-sql-query"
    | "generate-experiment-keywords"
    | "visual-changeset-copy-transform-energetic"
    | "visual-changeset-copy-transform-concise"
    | "visual-changeset-copy-transform-humorous";
  isDefaultPrompt: boolean;
  returnType?: "text" | "json";
  jsonSchema?: JSONSchema;
}) => {
  const { context } = params;
  const { aiEnabled, aiProvider } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization.");
  }

  if (aiProvider === "openai") {
    return openaiCompletion(params);
  } else if (aiProvider === "ollama") {
    return ollamaCompletion(params);
  } else {
    throw new Error("No valid AI provider configured.");
  }
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
  context: ReqContext;
  instructions?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  type:
    | "experiment-analysis"
    | "metric-description"
    | "experiment-hypothesis"
    | "generate-sql-query"
    | "generate-experiment-keywords"
    | "visual-changeset-copy-transform-energetic"
    | "visual-changeset-copy-transform-concise"
    | "visual-changeset-copy-transform-humorous";
  isDefaultPrompt: boolean;
  zodObjectSchema: T;
}): Promise<z.infer<T>> => {
  const { aiEnabled, aiProvider } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization.");
  }

  if (aiProvider === "openai") {
    return openaiParsePrompt({
      context,
      instructions,
      prompt,
      maxTokens,
      temperature,
      type,
      isDefaultPrompt,
      zodObjectSchema,
    });
  } else if (aiProvider === "ollama") {
    return ollamaParsePrompt({
      context,
      instructions,
      prompt,
      maxTokens,
      temperature,
      type,
      isDefaultPrompt,
      zodObjectSchema,
    });
  } else {
    throw new Error("No valid AI provider configured.");
  }
};

export const supportsJSONSchema = (context: ReqContext, model: string) => {
  const { aiProvider } = getAISettingsForOrg(context);

  if (aiProvider === "openai") {
    return supportsJSONSchemaOpenAI(model as TiktokenModel);
  } else if (aiProvider === "ollama") {
    return supportsJSONSchemaOllama(model);
  } else {
    throw new Error("No valid AI provider configured.");
  }
};

export const generateEmbeddings = async ({
  context,
  input,
}: {
  context: ReqContext;
  input: string[];
}) => {
  const { aiEnabled, aiProvider } = getAISettingsForOrg(context);

  if (!aiEnabled) {
    throw new Error("AI is not enabled for this organization.");
  }

  if (aiProvider === "openai") {
    return generateEmbeddingsOpenAI({ context, input });
  } else if (aiProvider === "ollama") {
    return generateEmbeddingsOllama({ context, input });
  } else {
    throw new Error("No valid AI provider configured.");
  }
};

export const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must be of the same length");
  }
  const dot = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const normA = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
};
