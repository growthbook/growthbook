import * as Sentry from "@sentry/node";
import { AccountPlan } from "shared/enterprise";
import {
  OrganizationInterface,
  OrganizationUsage,
} from "shared/types/organization";
import {
  callLicenseServer,
  LICENSE_SERVER_URL,
} from "back-end/src/enterprise/licenseUtil";
import { getEffectiveAccountPlan } from "back-end/src/enterprise";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";

const PLANS_WITH_UNLIMITED_USAGE: AccountPlan[] = [
  "pro",
  "pro_sso",
  "enterprise",
];

export const UNLIMITED_USAGE: OrganizationUsage = {
  limits: { requests: "unlimited", bandwidth: "unlimited" },
  cdn: {
    lastUpdated: new Date(),
    status: "under",
  },
};

export async function createSetupIntent(licenseKey: string) {
  const url = `${LICENSE_SERVER_URL}subscription/setup-intent`;
  const res = await callLicenseServer({
    url,
    body: JSON.stringify({
      licenseKey,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
  return res;
}

export async function getPaymentMethodsByLicenseKey(licenseKey: string) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods`;
  const res = await callLicenseServer({
    url,
    body: JSON.stringify({
      licenseKey,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
  return res;
}

export async function updateDefaultPaymentMethod(
  licenseKey: string,
  paymentMethodId: string,
) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods/set-default`;
  const res = await callLicenseServer({
    url,
    body: JSON.stringify({
      licenseKey,
      paymentMethodId,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
  return res;
}

export async function deletePaymentMethodById(
  licenseKey: string,
  paymentMethodId: string,
) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods/detach`;
  const res = await callLicenseServer({
    url,
    body: JSON.stringify({
      licenseKey,
      paymentMethodId,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
  return res;
}

export async function updateUsageDataFromServer(orgId: string) {
  try {
    const url = `${LICENSE_SERVER_URL}cdn/${orgId}/usage`;

    const usage = await callLicenseServer({ url, method: "GET" });

    setUsageInCache(orgId, usage);
  } catch (err) {
    Sentry.captureException(err);
  }
}

export let backgroundUpdateUsageDataFromServerForTests: Promise<void>;

type StoredUsage = {
  timestamp: Date;
  usage: OrganizationUsage;
};

const keyToUsageData: Record<string, StoredUsage> = {};

export const setUsageInCache = (orgId: string, usage: OrganizationUsage) => {
  keyToUsageData[orgId] = {
    timestamp: new Date(),
    usage: {
      ...usage,
      cdn: { ...usage.cdn, lastUpdated: new Date(usage.cdn.lastUpdated) },
    },
  };
};

export const resetUsageCache = () => {
  Object.keys(keyToUsageData).forEach((key) => {
    delete keyToUsageData[key];
  });
};

function getCachedUsageIfValid(
  organization: OrganizationInterface,
): OrganizationUsage | undefined {
  if (!IS_CLOUD) {
    return UNLIMITED_USAGE;
  }
  const plan = getEffectiveAccountPlan(organization);

  if (PLANS_WITH_UNLIMITED_USAGE.includes(plan)) return UNLIMITED_USAGE;

  const cacheCutOff = new Date();
  cacheCutOff.setHours(cacheCutOff.getHours() - 1);

  const usage = keyToUsageData[organization.id];

  if (!usage || usage.timestamp <= cacheCutOff) {
    return undefined;
  }

  return usage.usage;
}

export function getUsageFromCache(organization: OrganizationInterface) {
  const cachedUsage = getCachedUsageIfValid(organization);
  if (cachedUsage) {
    return cachedUsage;
  }

  // Don't await for the result, we will just keep showing out of date cached version or the fallback
  backgroundUpdateUsageDataFromServerForTests = updateUsageDataFromServer(
    organization.id,
  ).catch((err) => {
    logger.error(err, `Error getting usage data from server`);
  });

  return keyToUsageData[organization.id]?.usage || UNLIMITED_USAGE;
}

export async function getUsage(organization: OrganizationInterface) {
  const cachedUsage = getCachedUsageIfValid(organization);
  if (cachedUsage) {
    return cachedUsage;
  }

  if (keyToUsageData[organization.id]) {
    // If we have a cached version, but it's invalid, we will update it in the background
    backgroundUpdateUsageDataFromServerForTests = updateUsageDataFromServer(
      organization.id,
    ).catch((err) => {
      logger.error(err, `Error getting usage data from server`);
    });
  } else {
    await updateUsageDataFromServer(organization.id);
  }

  // If the updateUsageDataFromServer failed we fall back to unlimited usage
  return keyToUsageData[organization.id]?.usage || UNLIMITED_USAGE;
}
