import { omit } from "lodash";
import mongoose from "mongoose";
import { AITokenUsageInterface } from "shared/ai";
import { OrganizationInterface } from "shared/types/organization";
import { parseEnvInt } from "shared/util";
import { IS_CLOUD } from "back-end/src/util/secrets";

type AITokenUsageDocument = mongoose.Document & AITokenUsageInterface;

const DAILY_TOKEN_LIMIT = parseEnvInt(
  process.env.OPENAI_DAILY_TOKEN_LIMIT,
  1_000_000,
  { min: 1, name: "OPENAI_DAILY_TOKEN_LIMIT" },
);
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
  const now = new Date().getTime();

  // Roll the window first. Self-limiting under concurrency: once one writer
  // sets lastResetAt to now, the filter stops matching for everyone else.
  await AITokenUsageModel.updateOne(
    {
      organization: organization.id,
      lastResetAt: { $lt: now - RESET_INTERVAL },
    },
    { $set: { numTokensUsed: 0, lastResetAt: now } },
  );

  // $inc rather than read-modify-save. Concurrent AI calls used to read the
  // same total and overwrite each other's charge, undercounting usage against
  // the daily cap. dailyLimit is set explicitly on insert rather than left to
  // the schema default, because an undefined limit reads as "never over cap".
  const tokenUsage = await AITokenUsageModel.findOneAndUpdate(
    { organization: organization.id },
    {
      $inc: { numTokensUsed },
      $setOnInsert: { lastResetAt: now, dailyLimit: DAILY_TOKEN_LIMIT },
    },
    { new: true, upsert: true },
  );

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
