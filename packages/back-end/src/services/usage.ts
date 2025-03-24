import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { getEffectiveAccountPlan } from "shared/enterprise";
import { MONGODB_URI } from "back-end/src/util/secrets";
import { UsageLimits } from "back-end/types/organization";

type OrganizationUsage = {
  limits: {
    requests: number | "unlimited";
    bandwidth: number | "unlimited";
  };
};

const backendLimits = ({
  limits: { requests: cdnRequests, bandwidth: cdnBandwidth },
}: OrganizationUsage) => ({ cdnRequests, cdnBandwidth });

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
  const collection = (await getMongoUsageDb()).collection<OrganizationUsage>(
    "organizations_usage"
  );

  const storedLimits = await collection.findOne({
    organization,
  });

  if (storedLimits) return backendLimits(storedLimits);

  const plan = getEffectiveAccountPlan({ id: organization });

  if (plan === "starter") {
    return { cdnRequests: 1_000_000, cdnBandwidth: 5_000_000_000 };
  }

  if (plan === "pro" || plan === "pro_sso") {
    return { cdnRequests: 2_000_000, cdnBandwidth: 20_000_000_000 };
  }

  return { cdnRequests: "unlimited", cdnBandwidth: "unlimited" };
};
