import * as Sentry from "@sentry/node";
import { AccountPlan } from "shared/enterprise";
import {
  callLicenseServer,
  LICENSE_SERVER_URL,
} from "back-end/src/enterprise/licenseUtil";
import {
  OrganizationInterface,
  OrganizationUsage,
} from "back-end/types/organization";
import { getEffectiveAccountPlan } from "back-end/src/enterprise";

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
  paymentMethodId: string
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
  paymentMethodId: string
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

export async function getUsageDataFromServer(
  organization: string
): Promise<OrganizationUsage> {
  try {
    const url = `${LICENSE_SERVER_URL}cdn/${organization}/usage`;

    const usage = await callLicenseServer({ url, method: "GET" });

    return {
      ...usage,
      cdn: { ...usage.cdn, lastUpdated: new Date(usage.cdn.lastUpdated) },
    };
  } catch (err) {
    Sentry.captureException(err);
    return UNLIMITED_USAGE;
  }
}

type StoredUsage = {
  timestamp: Date;
  usage: OrganizationUsage;
};

const keyToUsageData: Record<string, StoredUsage> = {};

export async function getUsage(organization: OrganizationInterface) {
  const plan = getEffectiveAccountPlan(organization);

  if (PLANS_WITH_UNLIMITED_USAGE.includes(plan)) return UNLIMITED_USAGE;

  const cacheCutOff = new Date();
  cacheCutOff.setHours(cacheCutOff.getHours() - 1);

  if (keyToUsageData[organization.id]?.timestamp <= cacheCutOff)
    delete keyToUsageData[organization.id];

  if (keyToUsageData[organization.id])
    return keyToUsageData[organization.id].usage;

  const usage = await getUsageDataFromServer(organization.id);

  keyToUsageData[organization.id] = {
    timestamp: new Date(),
    usage,
  };

  return usage;
}
