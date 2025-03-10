import { callLicenseServer, LICENSE_SERVER_URL } from "shared/enterprise";

export async function createSetupIntent(licenseKey: string) {
  const url = `${LICENSE_SERVER_URL}subscription/setup-intent`;
  const res = await callLicenseServer(
    url,
    JSON.stringify({
      licenseKey,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
  return res;
}

export async function getPaymentMethodsByLicenseKey(licenseKey: string) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods`;
  const res = await callLicenseServer(
    url,
    JSON.stringify({
      licenseKey,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
  return res;
}

export async function updateDefaultPaymentMethod(
  licenseKey: string,
  paymentMethodId: string
) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods/set-default`;
  const res = await callLicenseServer(
    url,
    JSON.stringify({
      licenseKey,
      paymentMethodId,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
  return res;
}

export async function deletePaymentMethodById(
  licenseKey: string,
  paymentMethodId: string
) {
  const url = `${LICENSE_SERVER_URL}subscription/payment-methods/detach`;
  const res = await callLicenseServer(
    url,
    JSON.stringify({
      licenseKey,
      paymentMethodId,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
  return res;
}
