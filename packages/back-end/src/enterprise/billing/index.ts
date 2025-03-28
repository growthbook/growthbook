import * as Sentry from "@sentry/node";
import {
  callLicenseServer,
  LICENSE_SERVER_URL,
} from "back-end/src/enterprise/licenseUtil";
import { OrganizationUsage } from "back-end/types/organization";

export const FALLBACK_USAGE: OrganizationUsage = {
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
    return FALLBACK_USAGE;
  }
}

type StoredUsage = {
  timestamp: Date;
  usage: OrganizationUsage;
};

const keyToUsageData: Record<string, StoredUsage> = {};

export async function getUsage(organization: string) {
  const cacheCutOff = new Date();
  cacheCutOff.setHours(cacheCutOff.getHours() - 1);

  if (keyToUsageData[organization]?.timestamp <= cacheCutOff)
    delete keyToUsageData[organization];

  if (keyToUsageData[organization]) return keyToUsageData[organization].usage;

  const usage = await getUsageDataFromServer(organization);

  keyToUsageData[organization] = {
    timestamp: new Date(),
    usage,
  };

  return usage;
}
