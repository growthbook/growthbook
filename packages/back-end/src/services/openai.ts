import { OpenAI } from "openai";
import { encoding_for_model, get_encoding } from "@dqbd/tiktoken";
import { logger } from "back-end/src/util/logger";
import { OrganizationInterface } from "back-end/types/organization";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "back-end/src/models/AITokenUsageModel";

const MODEL = "gpt-4o-mini";

/**
 * The MODEL_TOKEN_LIMIT is the maximum number of tokens that can be sent to
 * the OpenAI API in a single request. This limit is imposed by OpenAI.
 *
 */
const MODEL_TOKEN_LIMIT = 4096;
// Require a minimum of 30 tokens for responses.
const MESSAGE_TOKEN_LIMIT = MODEL_TOKEN_LIMIT - 30;

let _openai: OpenAI | null = null;
export const getOpenAI = () => {
  if (_openai == null) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "",
    });
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
    encoding = encoding_for_model(MODEL);
  } catch (e) {
    logger.warn(
      `services/openai - Could not find encoding for model "${MODEL}"`
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

export const hasExceededUsageQuota = async (
  organization: OrganizationInterface
) => {
  const { numTokensUsed, dailyLimit } = await getTokensUsedByOrganization(
    organization
  );
  return numTokensUsed > dailyLimit;
};

export const simpleCompletion = async ({
  behavior,
  prompt,
  maxTokens,
  organization,
  temperature,
  priorKnowledge,
}: {
  behavior: string;
  prompt: string;
  priorKnowledge?: string[];
  maxTokens?: number;
  temperature?: number;
  organization: OrganizationInterface;
}) => {
  const openai = getOpenAI();

  // Content moderation check
  const moderationResponse = await openai.moderations.create({ input: prompt });
  if (moderationResponse.results.some((r) => r.flagged)) {
    throw new Error("Prompt was flagged by OpenAI moderation");
  }

  const messages: ChatCompletionRequestMessage[] = [
    {
      role: "user",
      content: behavior,
    },
    {
      role: "user",
      content: prompt,
    },
    ...(priorKnowledge || []).map<ChatCompletionRequestMessage>((message) => ({
      role: "assistant",
      content: message,
    })),
  ];

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
    model: MODEL,
    messages,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = response.usage?.total_tokens ?? numTokens;
  await updateTokenUsage({ numTokensUsed, organization });

  return response.choices[0].message?.content || "";
};
