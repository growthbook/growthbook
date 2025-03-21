import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { getEffectiveAccountPlan } from "shared/enterprise";
import { MONGODB_URI } from "back-end/src/util/secrets";
import { UsageLimits } from "back-end/types/organization";

type OrganizationLimits = {
  requests: number | "unlimited";
  bandwidth: number | "unlimited";
};

type OrganizationUsage = {
  limits: OrganizationLimits;
  cdn: {
    lastUpdated: Date;
    status: "under" | "approaching" | "over";
  };
};

type OrganizationUsageDocument = {
  organization: string;
  usage: OrganizationUsage;
};

const backendLimits = ({
  limits: { requests: cdnRequests, bandwidth: cdnBandwidth },
}: OrganizationUsage) => ({ cdnRequests, cdnBandwidth });

export const STARTER_PLAN_LIMITS = {
  requests: 1_000_000,
  bandwidth: 5_000_000_000,
} as const;
export const PRO_PLAN_LIMITS = {
  requests: 2_000_000,
  bandwidth: 20_000_000_000,
} as const;
export const ENTERPRISE_PLAN_LIMITS = {
  requests: "unlimited",
  bandwidth: "unlimited",
} as const;

let cachedClient: MongoClient | undefined;
let cachedDb: Db | undefined;

export const getMongoUsageDb = async () => {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
  }

  if (!cachedDb) cachedDb = await cachedClient.db("usage");

  return cachedDb;
};

export const closeMongoUsageDb = async () => {
  if (!cachedClient) return;

  await cachedClient.close();
  cachedClient = undefined;
};

export const getOrgUsageLimits = async (
  organization: string
): Promise<UsageLimits> => {
  const collection = (
    await getMongoUsageDb()
  ).collection<OrganizationUsageDocument>("organizations_usage");

  const storedUsage = await collection.findOne({
    organization,
  });

  const plan = getEffectiveAccountPlan({ id: organization });

  const planLimits = (() => {
    if (plan === "starter")
      return storedUsage?.usage.limits || STARTER_PLAN_LIMITS;

    if (plan === "pro" || plan === "pro_sso") return PRO_PLAN_LIMITS;

    return ENTERPRISE_PLAN_LIMITS;
  })();

  const planUsage: OrganizationUsage = {
    cdn: {
      lastUpdated: new Date(),
      status: "under",
    },
    ...storedUsage?.usage,
    limits: planLimits,
  };

  if (
    !storedUsage ||
    planUsage.limits.requests !== storedUsage.usage.limits.requests ||
    planUsage.limits.bandwidth !== storedUsage.usage.limits.bandwidth
  ) {
    await collection.updateOne(
      { organization },
      { $set: { usage: planUsage } }
    );
  }

  return backendLimits(planUsage);
};
