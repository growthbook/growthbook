import { omit } from "lodash";
import mongoose from "mongoose";
import { AITokenUsageInterface } from "shared/ai";
import { OrganizationInterface } from "shared/types/organization";
import { IS_CLOUD } from "back-end/src/util/secrets";

type AITokenUsageDocument = mongoose.Document & AITokenUsageInterface;

const DAILY_TOKEN_LIMIT = process.env.OPENAI_DAILY_TOKEN_LIMIT || 1000000;
const RESET_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const aiTokenUsageSchema = new mongoose.Schema({
  id: String,
  organization: String,
  numTokensUsed: Number,
  lastResetAt: Number,
  dailyLimit: { type: Number, default: DAILY_TOKEN_LIMIT },
});

aiTokenUsageSchema.index({ organization: 1 }, { unique: true });

const AITokenUsageModel = mongoose.model<AITokenUsageDocument>(
  "AITokenUsage",
  aiTokenUsageSchema,
);

const toInterface = (doc: AITokenUsageDocument): AITokenUsageInterface =>
  omit(doc.toJSON<AITokenUsageDocument>(), ["__v", "_id"]);

export const updateTokenUsage = async ({
  organization,
  numTokensUsed,
}: {
  organization: OrganizationInterface;
  numTokensUsed: number;
}) => {
  if (!IS_CLOUD) {
    return {
      numTokensUsed: 0,
      dailyLimit: Infinity,
      lastResetAt: new Date().getTime(),
    };
  }
  let tokenUsage = await AITokenUsageModel.findOne({
    organization: organization.id,
  });

  if (!tokenUsage) {
    tokenUsage = await AITokenUsageModel.create({
      organization: organization.id,
      numTokensUsed: 0,
      lastResetAt: new Date().getTime(),
    });
  }

  const lastResetAt = tokenUsage.lastResetAt;
  const now = new Date().getTime();
  if (now - lastResetAt > RESET_INTERVAL) {
    tokenUsage.lastResetAt = now;
    tokenUsage.numTokensUsed = 0;
  }

  tokenUsage.numTokensUsed += numTokensUsed;

  await tokenUsage.save();

  return toInterface(tokenUsage);
};

export const getTokensUsedByOrganization = async (
  organization: OrganizationInterface,
): Promise<{
  numTokensUsed: number;
  dailyLimit: number;
  nextResetAt: number;
}> => {
  if (!IS_CLOUD) {
    return {
      numTokensUsed: 0,
      dailyLimit: Infinity,
      nextResetAt: new Date().getTime(),
    };
  }
  const { numTokensUsed, dailyLimit, lastResetAt } = await updateTokenUsage({
    organization,
    numTokensUsed: 0,
  });
  const nextResetAt = lastResetAt + RESET_INTERVAL;
  return { numTokensUsed, dailyLimit, nextResetAt };
};
