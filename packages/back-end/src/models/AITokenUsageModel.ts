import { omit } from "lodash";
import mongoose from "mongoose";
import { AITokenUsageInterface } from "shared/ai";
import { OrganizationInterface } from "shared/types/organization";
import { parseEnvInt } from "shared/util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { getEffectiveAccountPlan } from "back-end/src/enterprise/licenseUtil";

type AITokenUsageDocument = mongoose.Document & AITokenUsageInterface;

const DAILY_TOKEN_LIMIT = parseEnvInt(
  process.env.OPENAI_DAILY_TOKEN_LIMIT,
  1_000_000,
  { min: 1, name: "OPENAI_DAILY_TOKEN_LIMIT" },
);
// Enterprise usage is currently uncapped.
const ENTERPRISE_DAILY_TOKEN_LIMIT = Infinity;
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

export const getDailyTokenLimit = (
  organization: OrganizationInterface,
  storedLimit: number,
): number =>
  getEffectiveAccountPlan(organization) === "enterprise"
    ? ENTERPRISE_DAILY_TOKEN_LIMIT
    : storedLimit;

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

  // Roll the window first; the filter stops matching once one writer resets it.
  await AITokenUsageModel.updateOne(
    {
      organization: organization.id,
      lastResetAt: { $lt: now - RESET_INTERVAL },
    },
    { $set: { numTokensUsed: 0, lastResetAt: now } },
  );

  // $inc, not read-modify-save: concurrent calls used to overwrite each other's charge.
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
  return {
    numTokensUsed,
    dailyLimit: getDailyTokenLimit(organization, dailyLimit),
    nextResetAt: lastResetAt + RESET_INTERVAL,
  };
};
