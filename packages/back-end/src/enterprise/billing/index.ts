import { callLicenseServer, LICENSE_SERVER_URL } from "shared/enterprise";
import { OrganizationUsage } from "back-end/types/organization";

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
  const url = `${LICENSE_SERVER_URL}cdn/${organization}/usage`;

  const usage = await callLicenseServer({ url, method: "GET" });

  return {
    ...usage,
    cdn: { ...usage.cdn, lastUpdated: new Date(usage.cdn.lastUpdated) },
  };
}

const keyToUsageData: Record<string, OrganizationUsage> = {};

export async function getUsage(organization: string) {
  const cacheCutOff = new Date();
  cacheCutOff.setHours(cacheCutOff.getHours() - 1);

  Object.keys(keyToUsageData).forEach((organization) => {
    if (keyToUsageData[organization]?.cdn.lastUpdated <= cacheCutOff)
      delete keyToUsageData[organization];
  });

  if (keyToUsageData[organization]) return keyToUsageData[organization];

  const usage = await getUsageDataFromServer(organization);

  keyToUsageData[organization] = usage;

  return usage;
}
