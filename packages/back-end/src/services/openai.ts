import { Configuration, OpenAIApi, ChatCompletionRequestMessage } from "openai";
import { encoding_for_model, get_encoding } from "@dqbd/tiktoken";
import { logger } from "../util/logger";
import { OrganizationInterface } from "../../types/organization";
import {
  getTokensUsedByOrganization,
  updateTokenUsage,
} from "../models/AITokenUsageModel";

/**
 * Snapshot of gpt-3.5-turbo from March 1st 2023. Unlike gpt-3.5-turbo, this
 * model will not receive updates, and will be deprecated 3 months after a new
 * version is released.
 *
 * We use this model to ensure behavior doesn't change while gpt-3.5-turbo is
 * updated. Additionally, token counts will be more predictable.
 */
const MODEL = "gpt-3.5-turbo-0301";

/**
 * The MODEL_TOKEN_LIMIT is the maximum number of tokens that can be sent to
 * the OpenAI API in a single request. This limit is imposed by OpenAI.
 *
 * Note too that very long conversations are more likely to receive incomplete
 * replies. For example, a gpt-3.5-turbo conversation that is 4090 tokens long
 * will have its reply cut off after just 6 tokens.
 */
const MODEL_TOKEN_LIMIT = 4096;
// Require a minimum of 30 tokens for responses.
const MESSAGE_TOKEN_LIMIT = MODEL_TOKEN_LIMIT - 30;

let _openai: OpenAIApi | null = null;
export const getOpenAI = () => {
  if (_openai == null) {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY || "",
    });
    _openai = new OpenAIApi(configuration);
  }
  return _openai;
};

/**
 * Function for counting tokens for messages passed to gpt-3.5-turbo-0301.
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
      `services/openai - Could not find encoding for model "${MODEL}"`,
    );
    encoding = get_encoding("cl100k_base");
  }

  let numTokens = 0;
  for (const message of messages) {
    numTokens += 4; // every message follows <im_start>{role/name}\n{content}<im_end>\n
    for (const [key, value] of Object.entries(message)) {
      numTokens += encoding.encode(value).length;
      if (key === "name") numTokens -= 1; // if there's a name, the role is omitted
    }
  }

  numTokens += 2; // every reply is primed with <im_start>assistant

  return numTokens;
};

export const hasExceededUsageQuota = async (
  organization: OrganizationInterface,
) => {
  const { numTokensUsed, dailyLimit } =
    await getTokensUsedByOrganization(organization);
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

  const messages: ChatCompletionRequestMessage[] = [
    {
      // In general, gpt-3.5-turbo-0301 does not pay strong attention to the
      // system message, and therefore important instructions are often better
      // placed in a user message.
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
      `Number of tokens (${numTokens}) exceeds maxTokens (${maxTokens})`,
    );
  }
  if (numTokens > MESSAGE_TOKEN_LIMIT) {
    throw new Error(
      `Number of tokens (${numTokens}) exceeds MESSAGE_TOKEN_LIMIT (${MESSAGE_TOKEN_LIMIT})`,
    );
  }

  const inputModerationRes = await openai.createModeration({ input: prompt });
  if (inputModerationRes.data.results.some((r) => r.flagged)) {
    throw new Error("Prompt was flagged by OpenAI moderation");
  }

  const response = await openai.createChatCompletion({
    model: MODEL,
    messages,
    ...(temperature != null ? { temperature } : {}),
  });

  const numTokensUsed = response.data.usage?.total_tokens ?? numTokens; // fallback to numTokens if usage is not available
  await updateTokenUsage({ numTokensUsed, organization });

  const outputModerationRes = await openai.createModeration({ input: prompt });
  if (outputModerationRes.data.results.some((r) => r.flagged)) {
    throw new Error("Output was flagged by OpenAI moderation");
  }

  return response.data.choices[0].message?.content || "";
};
