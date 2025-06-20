import { OpenAI } from "openai";
import {
  encoding_for_model,
  get_encoding,
  TiktokenModel,
} from "@dqbd/tiktoken";
import { AIPromptType } from "shared/ai";
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

let _openai: OpenAI | null = null;
let _openAIModel: TiktokenModel = "gpt-4o-mini";
export const getOpenAI = (context: ReqContext | ApiReqContext) => {
  if (_openai == null) {
    const { aiEnabled, openAIAPIKey, openAIDefaultModel } = getAISettingsForOrg(
      context,
      true
    );
    // use the org settings if they exist, otherwise use the env var
    const openAIKey = openAIAPIKey || process.env.OPENAI_API_KEY;
    _openAIModel = openAIDefaultModel;
    if (openAIKey && aiEnabled) {
      _openai = new OpenAI({
        apiKey: openAIKey || "",
      });
    }
  }
  return _openai;
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
const numTokensFromMessages = (messages: ChatCompletionRequestMessage[]) => {
  let encoding;
  try {
    encoding = encoding_for_model(_openAIModel);
  } catch (e) {
    logger.warn(
      `services/openai - Could not find encoding for model "${_openAIModel}"`
    );
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
  const openai = getOpenAI(context);

  if (openai == null) {
    throw new Error("OpenAI not enabled or key not set");
  }
  // Content moderation check
  const moderationResponse = await openai.moderations.create({ input: prompt });
  if (moderationResponse.results.some((r) => r.flagged)) {
    throw new Error("Prompt was flagged by OpenAI moderation");
  }

  const messages: ChatCompletionRequestMessage[] = [];

  if (instructions) {
    messages.push({
      role: "system",
      content: instructions,
    });
  }
  messages.push({ role: "user", content: prompt });

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

  const response = await openai.chat.completions.create({
    model: _openAIModel,
    messages,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = response.usage?.total_tokens ?? numTokens;
  try {
    // Fire and forget
    logCloudAIUsage({
      organization: context.org.id,
      type,
      model: _openAIModel,
      numPromptTokensUsed: response.usage?.prompt_tokens ?? 0,
      numCompletionTokensUsed: response.usage?.completion_tokens ?? 0,
      temperature,
      usedDefaultPrompt: isDefaultPrompt,
    });
  } catch (e) {
    logger.error(e, "Failed to log AI usage to Clickhouse");
  }

  await updateTokenUsage({ numTokensUsed, organization: context.org });

  return response.choices[0].message?.content || "";
};

export const generateEmbeddings = async ({
  context,
  input,
}: {
  context: ReqContext | ApiReqContext;
  input: string[];
}) => {
  const openai = getOpenAI(context);

  if (openai == null) {
    throw new Error("OpenAI not enabled or key not set");
  }

  if (!input) {
    throw new Error("No input provided for embeddings generation.");
  }

  try {
    return await openai.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });
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
