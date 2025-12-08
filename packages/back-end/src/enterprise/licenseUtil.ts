import crypto from "crypto";
import type Stripe from "stripe";
import pino from "pino";
import { pick, sortBy } from "lodash";
import AsyncLock from "async-lock";
import { parseProcessLogBase, stringToBoolean } from "shared/util";
import { ProxyAgent } from "proxy-agent";
import cloneDeep from "lodash/cloneDeep";
import {
  accountFeatures,
  AccountPlan,
  accountPlans,
  CommercialFeature,
  CommercialFeaturesMap,
  LicenseData,
  LicenseInterface,
  LicenseMetaData,
  LicenseUserCodes,
  SubscriptionInfo,
} from "shared/enterprise";
import { StripeAddress, TaxIdType } from "shared/types/subscriptions";
import { fetch } from "back-end/src/util/http.util";
import { OrganizationInterface } from "back-end/types/organization";
import { getLicenseByKey, LicenseModel } from "./models/licenseModel";
import { LICENSE_PUBLIC_KEY } from "./public-key";

export const LICENSE_SERVER_URL =
  process.env.LICENSE_SERVER_URL ||
  "https://central_license_server.growthbook.io/api/v1/";

// mimic behavior in back-end/src/util/secrets.ts
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:3000";

const logBase = parseProcessLogBase();

const logger = pino({
  ...logBase,
});

function getStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SubscriptionInfo["status"] {
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  return "";
}

export function getSubscriptionFromLicense(
  license: Partial<LicenseInterface>,
): SubscriptionInfo | null {
  const sub = license.orbSubscription || license.stripeSubscription;

  if (!sub) return null;

  return {
    billingPlatform: license.orbSubscription ? "orb" : "stripe",
    externalId: sub.id,
    trialEnd: sub.trialEnd,
    status: getStripeSubscriptionStatus(sub.status),
    hasPaymentMethod: !!sub.hasPaymentMethod,
    nextBillDate: new Date((sub.current_period_end || 0) * 1000).toDateString(),
    dateToBeCanceled: new Date((sub.cancel_at || 0) * 1000).toDateString(),
    cancelationDate: new Date((sub.canceled_at || 0) * 1000).toDateString(),
    pendingCancelation: sub.status !== "canceled" && !!sub.cancel_at_period_end,
    isVercelIntegration: !!license.vercelInstallationId,
  };
}

type MinimalOrganization = {
  id: string;
  licenseKey?: string;
  enterprise?: boolean;
  restrictAuthSubPrefix?: string;
  restrictLoginMethod?: string;
  isVercelIntegration?: boolean;
  subscription?: {
    status: Stripe.Subscription.Status;
  };
};

export function getLowestPlanPerFeature(
  accountFeatures: CommercialFeaturesMap,
): Partial<Record<CommercialFeature, AccountPlan>> {
  const lowestPlanPerFeature: Partial<Record<CommercialFeature, AccountPlan>> =
    {};

  // evaluate in order from highest to lowest plan
  const plansFromHighToLow: AccountPlan[] = [
    "enterprise",
    "pro_sso",
    "pro",
    "starter",
    "oss",
  ];
  plansFromHighToLow.forEach((accountPlan) => {
    accountFeatures[accountPlan].forEach((feature) => {
      lowestPlanPerFeature[feature] = accountPlan;
    });
  });

  return lowestPlanPerFeature;
}

export function isActiveSubscriptionStatus(
  status?: Stripe.Subscription.Status | SubscriptionInfo["status"],
) {
  return ["active", "trialing", "past_due"].includes(status || "");
}

// This returns the actual plan the organzation is on.  If you would prefer to know
// what plan the organization is effectively on (taking into account downgrades)
// use getEffectiveAccountPlan() instead.
export function getAccountPlan(org: MinimalOrganization): AccountPlan {
  if (stringToBoolean(process.env.IS_CLOUD)) {
    if (org.licenseKey) {
      return getLicense(org.licenseKey)?.plan || "starter";
    }
    // Vercel starter orgs have the `restrictLoginMethod` set, but they're not pro_sso
    if (org.isVercelIntegration) return "starter";
    if (org.enterprise) return "enterprise";
    if (org.restrictAuthSubPrefix || org.restrictLoginMethod) return "pro_sso";
    return "starter";
  }

  // For self-hosted deployments
  return getLicense(org.licenseKey)?.plan || "oss";
}

function planHasPremiumFeature(
  plan: AccountPlan,
  feature: CommercialFeature,
): boolean {
  return accountFeatures[plan].has(feature);
}

export function orgHasPremiumFeature(
  org: MinimalOrganization,
  feature: CommercialFeature,
): boolean {
  return planHasPremiumFeature(getEffectiveAccountPlan(org), feature);
}

function getPublicKey(): Buffer {
  return Buffer.from(LICENSE_PUBLIC_KEY);
}

// The end of the key is base64 encoding of the sha256 hash and is random
// comparing the last 10 characters is enough that a chance of a collision is 1/2^60
const forbiddenAirGappedLicenseKeyEndings = ["JenaAbOBsY"];

function isForbiddenAirGappedLicenseKey(key?: string): boolean {
  if (!key) {
    return false;
  }
  return forbiddenAirGappedLicenseKeyEndings.some((ending) =>
    key.endsWith(ending),
  );
}

function getVerifiedLicenseData(key: string): Partial<LicenseInterface> {
  const [license, signature] = key
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));

  let decodedLicense: LicenseData;
  try {
    decodedLicense = JSON.parse(license.toString());
  } catch {
    throw new Error("Could not parse license");
  }

  // Support old way of storing expiration date
  decodedLicense.exp = decodedLicense.exp || decodedLicense.eat || "";
  if (!decodedLicense.exp) {
    throw new Error("Invalid License Key - Missing expiration date");
  }
  delete decodedLicense.eat;
  // The `trial` field used to be optional, force it to always be defined
  decodedLicense.trial = !!decodedLicense.trial;

  // We used to only offer license keys for Enterprise plans (not pro)
  if (!decodedLicense.plan) {
    decodedLicense.plan = "enterprise";
  }

  const convertedLicense: Partial<LicenseInterface> = {
    id: decodedLicense.ref,
    companyName: decodedLicense.sub,
    organizationId: decodedLicense.org,
    seats: decodedLicense.qty,
    hardCap: decodedLicense.hardCap || false,
    dateCreated: decodedLicense.iat,
    dateExpires: decodedLicense.exp,
    isTrial: decodedLicense.trial,
    plan: decodedLicense.plan,
  };

  // If the public key failed to load, just assume the license is valid
  const publicKey = getPublicKey();

  const isVerified = crypto.verify(
    "sha256",
    license,
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    },
    signature,
  );

  // License key signature is invalid, don't use it
  if (!isVerified) {
    throw new Error("Invalid license key signature");
  }

  logger.info(decodedLicense, "Using verified license key");

  return convertedLicense;
}

function verifyLicenseInterface(license: LicenseInterface) {
  if (
    license.usingMongoCache &&
    license.firstFailedFetchDate &&
    !license.signedChecksum
  ) {
    // If there has never been a successful fetch, don't verify the license, it just contains the server error message
    return;
  }

  const publicKey = getPublicKey();

  // In order to verify the license key, we need to strip out the fields that are not part of the signed license data
  // and sort the fields alphabetically as we do on the license server itself.
  const strippedLicense = pick(license, [
    "dateExpires",
    "seats",
    "seatsInUse",
    "archived",
    "remoteDowngrade",
    "isTrial",
    "organizationId",
    "plan",
  ]);
  const data = Object.fromEntries(sortBy(Object.entries(strippedLicense)));
  const dataBuffer = Buffer.from(JSON.stringify(data));

  const signature = Buffer.from(license.signedChecksum, "base64url");

  logger.info("Verifying license data: " + JSON.stringify(data));
  const isVerified = crypto.verify(
    "sha256",
    dataBuffer,
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    },
    signature,
  );

  // License key signature is invalid, don't use it
  if (!isVerified) {
    throw new Error("Invalid license key signature");
  }
}

function getAgentOptions() {
  const use_proxy =
    !!process.env.http_proxy ||
    !!process.env.https_proxy ||
    !!process.env.HTTPS_PROXY;
  return use_proxy ? { agent: new ProxyAgent() } : {};
}

export class LicenseServerError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "LicenseServerError";
  }
}

export async function callLicenseServer({
  url,
  body,
  method = "POST",
}: {
  url: string;
  body?: string;
  method?: string;
}) {
  const agentOptions = getAgentOptions();

  const options = {
    method: method,
    headers: {
      "Content-Type": "application/json",
    },
    body,
    ...agentOptions,
  };

  let serverResult;
  try {
    serverResult = await fetch(url, options);
  } catch (e) {
    logger.error(
      e,
      "Could not connect to license server. Make sure to whitelist 75.2.109.47.",
    );
    throw new LicenseServerError(
      "Could not connect to license server. Make sure to whitelist 75.2.109.47.",
      500,
    );
  }

  if (!serverResult.ok) {
    let errorText = await serverResult.text();
    try {
      const errorJson = JSON.parse(errorText);
      errorText = errorJson.error;
    } catch (e) {
      // errorText is not valid JSON, so do nothing and keep the original text
    }
    logger.error(`License Server error (${serverResult.status}): ${errorText}`);
    throw new LicenseServerError(
      `License server errored with: ${errorText}`,
      serverResult.status,
    );
  }

  return await serverResult.json();
}

export async function postVerifyEmailToLicenseServer(
  emailVerificationToken: string,
) {
  const url = `${LICENSE_SERVER_URL}license/verify-email`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      emailVerificationToken,
    }),
  });
}

export async function getCustomerDataFromServer(
  organizationId: string,
): Promise<{
  customerData: {
    name: string;
    email: string;
    address?: StripeAddress;
    taxConfig: {
      type: TaxIdType;
      value: string;
    };
  };
}> {
  const url = `${LICENSE_SERVER_URL}subscription/customer-data`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      organizationId,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
}

export async function updateCustomerDataFromServer(
  organizationId: string,
  customerData: {
    name: string;
    email: string;
    address?: StripeAddress;
    taxConfig: { type?: TaxIdType; value?: string };
  },
) {
  const url = `${LICENSE_SERVER_URL}subscription/update-customer-data`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      organizationId,
      name: customerData.name,
      email: customerData.email,
      address: customerData.address,
      taxConfig: customerData.taxConfig,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
}

export async function getPortalUrlFromServer(
  organizationId: string,
): Promise<{ portalUrl: string }> {
  const url = `${LICENSE_SERVER_URL}subscription/portal-url`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      organizationId,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
}

export async function postNewProTrialSubscriptionToLicenseServer(
  organizationId: string,
  companyName: string,
  name: string,
  email: string,
  seats: number,
) {
  const url = `${LICENSE_SERVER_URL}subscription/new-pro-trial`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      organizationId,
      companyName,
      name,
      email,
      seats,
      appOrigin: APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
}

export async function postNewProSubscriptionToLicenseServer(
  organizationId: string,
  companyName: string,
  ownerEmail: string,
  name: string,
  seats: number,
  returnUrl: string,
) {
  const url = `${LICENSE_SERVER_URL}subscription/new`;
  return callLicenseServer({
    url,
    body: JSON.stringify({
      appOrigin: APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
      organizationId,
      companyName,
      ownerEmail,
      name,
      seats,
      returnUrl,
    }),
  });
}

export async function postNewInlineSubscriptionToLicenseServer(
  organizationId: string,
  nonInviteSeatQty: number,
  email: string,
  additionalEmails: string[],
  name: string,
  address?: StripeAddress,
  taxConfig?: { type: TaxIdType; value: string },
) {
  const url = `${LICENSE_SERVER_URL}subscription/start-new-pro`;
  const license = await callLicenseServer({
    url,
    body: JSON.stringify({
      cloudSecret: process.env.CLOUD_SECRET,
      organizationId,
      nonInviteSeatQty,
      email,
      additionalEmails,
      taxConfig,
      name,
      address,
    }),
  });

  verifyAndSetServerLicenseData(license);
  return license;
}

export async function postNewVercelSubscriptionToLicenseServer(
  organization: OrganizationInterface,
  installationId: string,
  userName: string,
): Promise<LicenseInterface> {
  const url = `${LICENSE_SERVER_URL}subscription/new-vercel-native-subscription`;
  const license = await callLicenseServer({
    url,
    body: JSON.stringify({
      cloudSecret: process.env.CLOUD_SECRET,
      organizationId: organization.id,
      companyName: organization.name,
      ownerEmail: organization.ownerEmail,
      name: userName,
      nonInviteSeatQty: organization.members.length,
      installationId,
    }),
  });

  verifyAndSetServerLicenseData(license);
  return license;
}

export async function postNewProSubscriptionIntentToLicenseServer(
  organizationId: string,
  companyName: string,
  ownerEmail: string,
  name: string,
) {
  const url = `${LICENSE_SERVER_URL}subscription/setup-subscription-intent`;
  return await callLicenseServer({
    url,
    body: JSON.stringify({
      appOrigin: APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
      organizationId,
      companyName,
      ownerEmail,
      name,
    }),
  });
}

export async function postNewSubscriptionSuccessToLicenseServer(
  checkoutSessionId: string,
): Promise<LicenseInterface> {
  const url = `${LICENSE_SERVER_URL}subscription/success`;
  return await callLicenseServer({
    url,
    body: JSON.stringify({
      checkoutSessionId,
    }),
  });
}

export async function postCreateBillingSessionToLicenseServer(
  licenseId: string,
): Promise<{ url: string; status: number }> {
  const url = `${LICENSE_SERVER_URL}subscription/manage`;
  return await callLicenseServer({
    url,
    body: JSON.stringify({
      appOrigin: APP_ORIGIN,
      licenseId,
    }),
  });
}

export async function postCreateTrialEnterpriseLicenseToLicenseServer(
  email: string,
  name: string,
  organizationId: string,
  companyName: string,
  context: {
    organizationCreated: Date;
    currentSeats: number;
    currentPlan: AccountPlan;
    currentBuild: string;
    ctaSource: string;
  },
) {
  const url = `${LICENSE_SERVER_URL}license/new-enterprise-trial`;
  return await callLicenseServer({
    url,
    body: JSON.stringify({
      email,
      name,
      organizationId,
      companyName,
      context,
      appOrigin: APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
    }),
  });
}

export async function postCancelSubscriptionToLicenseServer(licenseId: string) {
  const url = `${LICENSE_SERVER_URL}subscription/cancel`;
  const license = await callLicenseServer({
    url,
    body: JSON.stringify({ licenseId, cloudSecret: process.env.CLOUD_SECRET }),
  });

  verifyAndSetServerLicenseData(license);
  return license;
}

export async function postResendEmailVerificationEmailToLicenseServer(
  organizationId: string,
) {
  const url = `${LICENSE_SERVER_URL}license/resend-license-email`;
  return await callLicenseServer({
    url,
    body: JSON.stringify({
      organizationId,
      appOrigin: APP_ORIGIN,
    }),
  });
}

// Creates or replaces the license in the MongoDB cache in case the license server goes down.
async function createOrReplaceLicenseMongoCache(license: LicenseInterface) {
  await LicenseModel.findOneAndReplace({ id: license.id }, license, {
    upsert: true,
  });
}

// Updates the in memory cache, the one week backup Mongo cache, and verifies the license.
export function verifyAndSetServerLicenseData(license: LicenseInterface) {
  verifyLicenseInterface(license);
  keyToLicenseData[license.id] = license;
  keyToCacheDate[license.id] = new Date();
  createOrReplaceLicenseMongoCache(license).catch((e) => {
    logger.error(e, "Error creating mongo cache");
    throw e;
  });
}

function verifyAndSetCachedLicenseData(license: LicenseInterface) {
  license.usingMongoCache = true;
  verifyLicenseInterface(license);
  keyToLicenseData[license.id] = license;
  keyToCacheDate[license.id] = new Date();
}

async function getLicenseDataFromServer(
  licenseId: string,
  licenseUserCodes: LicenseUserCodes,
  metaData: LicenseMetaData,
): Promise<LicenseInterface> {
  logger.info("Getting license data from server for " + licenseId);
  const url = `${LICENSE_SERVER_URL}license/${licenseId}/check`;

  const license = await callLicenseServer({
    url,
    body: JSON.stringify({
      licenseUserCodes: licenseUserCodes,
      metaData,
    }),
    method: "PUT",
  });

  return license;
}

async function updateLicenseFromServer(
  licenseKey: string,
  org: MinimalOrganization,
  getUserCodesForOrg: (org: MinimalOrganization) => Promise<LicenseUserCodes>,
  getLicenseMetaData: () => Promise<LicenseMetaData>,
  mongoCache: LicenseInterface | null,
) {
  let license: LicenseInterface;
  try {
    const licenseUserCodes = await getUserCodesForOrg(org);
    const metaData = await getLicenseMetaData();
    license = await getLicenseDataFromServer(
      licenseKey,
      licenseUserCodes,
      metaData,
    );
    verifyAndSetServerLicenseData(license);
  } catch (e) {
    // attach error data to the cache so we know how long the server has been down for
    const now = new Date();
    if (mongoCache === null) {
      // We are erroring on first attempt ever to fetch the license. We record the error
      // data so that we can show the error message to the user.
      license = {
        id: licenseKey,
        firstFailedFetchDate: now,
      } as LicenseInterface;
    } else {
      license = mongoCache;
      if (!license.firstFailedFetchDate) {
        license.firstFailedFetchDate = now;
      }
    }
    license.lastFailedFetchDate = now;
    license.lastServerErrorMessage = e.message;
    license.usingMongoCache = true;
    verifyAndSetServerLicenseData(license);
    throw e;
  }
  return license;
}

const lock = new AsyncLock();

// in-memory cache to avoid hitting the license server on every request
const keyToLicenseData: Record<string, Partial<LicenseInterface>> = {};
const keyToCacheDate: Record<string, Date> = {};

export let backgroundUpdateLicenseFromServerForTests: Promise<void | LicenseInterface>;

export async function licenseInit(
  org?: MinimalOrganization,
  getUserCodesForOrg?: (org: MinimalOrganization) => Promise<LicenseUserCodes>,
  getLicenseMetaData?: () => Promise<LicenseMetaData>,
  forceRefresh = false,
): Promise<Partial<LicenseInterface> | undefined> {
  const key = org?.licenseKey || process.env.LICENSE_KEY || null;

  if (!key) {
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

  // Only refetch the license data if forceRefresh is true
  // or if the license data is not in the cache
  // or if the cache date exists and is older than 1 minute
  if (
    forceRefresh ||
    !keyToLicenseData[key] ||
    (keyToCacheDate[key] !== null && keyToCacheDate[key] <= oneMinuteAgo)
  ) {
    if (!isAirGappedLicenseKey(key)) {
      if (!org || !getUserCodesForOrg || !getLicenseMetaData) {
        throw new Error(
          "Missing org, getUserCodesForOrg, or getLicenseMetaData for connected license key",
        );
      }

      //let license: LicenseInterface;
      const mongoCache = await getLicenseByKey(key);
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (
        forceRefresh ||
        !mongoCache ||
        !mongoCache.dateUpdated || // If the first call to get the license errors, the cache will be created with no dateUpdated
        new Date(mongoCache.dateUpdated) < oneWeekAgo
      ) {
        // It is time to update the license data from the server.
        // However when hitting a page we often make many simulataneous requests
        // By acquiring a lock we make sure to only call the license server once, the remaining
        // calls will be able to read from the cache.
        await lock.acquire(key, async () => {
          try {
            if (
              !forceRefresh &&
              keyToLicenseData[key] &&
              keyToCacheDate[key] > oneMinuteAgo
            ) {
              // Another request has already fetched the license data recently
              return;
            }

            // Fetch the license data from the cache again in case another request has updated it from a different server
            const mongoCache = await getLicenseByKey(key);
            if (
              forceRefresh ||
              !mongoCache ||
              !mongoCache.dateUpdated || // If the first call to get the license errors, the cache will be created with no dateUpdated
              new Date(mongoCache.dateUpdated) < oneWeekAgo
            ) {
              await updateLicenseFromServer(
                key,
                org,
                getUserCodesForOrg,
                getLicenseMetaData,
                mongoCache,
              );
            } else {
              // Use the newly created cache
              verifyAndSetCachedLicenseData(mongoCache);
            }
          } catch (e) {
            // Hack to get the stack trace to show the original call to licenseInit
            // as AsyncLock seems to swallow the top of the stack frame.
            const tempError = new Error();
            Error.captureStackTrace(tempError, licenseInit);
            e.stack += "\n" + tempError.stack?.split("\n").slice(1).join("\n");
            throw e;
          }
        });
      } else {
        // Use the cache
        verifyAndSetCachedLicenseData(mongoCache);
        if (new Date(mongoCache.dateUpdated) < oneDayAgo) {
          // But if it is older than a day update it in the background
          backgroundUpdateLicenseFromServerForTests = updateLicenseFromServer(
            key,
            org,
            getUserCodesForOrg,
            getLicenseMetaData,
            mongoCache,
          ).catch((e) => {
            logger.error(
              e,
              `Failed to update license ${key} in the background`,
            );
          });
        }
      }
    } else {
      // Old style: the key itself has the encrypted license data in it.
      keyToLicenseData[key] = getVerifiedLicenseData(key);
    }
  }

  // If an organization replaces an expired org.licenseKey with an env var
  // for license key that is not expired, use the env var license key instead.
  if (
    process.env.LICENSE_KEY &&
    key != process.env.LICENSE_KEY &&
    new Date(keyToLicenseData[key]?.dateExpires || "") < new Date()
  ) {
    const orgWithEnvVarAsLicenseKey = cloneDeep(org);
    if (orgWithEnvVarAsLicenseKey) {
      orgWithEnvVarAsLicenseKey.licenseKey = process.env.LICENSE_KEY;
    }

    const result = await licenseInit(
      orgWithEnvVarAsLicenseKey,
      getUserCodesForOrg,
      getLicenseMetaData,
      forceRefresh,
    );
    if (result) {
      keyToLicenseData[key] = result;
    }
  }

  return keyToLicenseData[key];
}

export function getLicense(key?: string) {
  if (!key) {
    if (process.env.LICENSE_KEY) {
      key = process.env.LICENSE_KEY;
    } else {
      return null;
    }
  }
  return keyToLicenseData[key];
}

export function resetInMemoryLicenseCache(): void {
  Object.keys(keyToLicenseData).forEach((key) => {
    delete keyToLicenseData[key];
  });
  Object.keys(keyToCacheDate).forEach((key) => {
    delete keyToLicenseData[key];
  });
}

export function getLicenseError(org: MinimalOrganization): string {
  const key = org.licenseKey || process.env.LICENSE_KEY;
  const licenseData = getLicense(key);

  if (
    !stringToBoolean(process.env.IS_CLOUD) &&
    process.env.SSO_CONFIG &&
    (!licenseData ||
      !licenseData.plan ||
      !planHasPremiumFeature(licenseData.plan, "sso"))
  ) {
    // Trying to use SSO, but the plan doesn't support it
    // We throw the error here, otherwise they would still be able to use SSO on free plans with only a warning.
    throw new Error(
      "You need an enterprise license for SSO functionality. Either upgrade to enterprise or remove SSO_CONFIG environment variable.",
    );
  }

  if (
    !stringToBoolean(process.env.IS_CLOUD) &&
    stringToBoolean(process.env.IS_MULTI_ORG) &&
    (!licenseData ||
      !licenseData.plan ||
      !planHasPremiumFeature(licenseData.plan, "multi-org"))
  ) {
    // Trying to use IS_MULTI_ORG, but the plan doesn't support it
    // We throw error here, otherwise they would still be able to use IS_MULTI_ORG on free plans.
    throw new Error(
      "You need an enterprise license for multi-org functionality. Either upgrade to enterprise or remove IS_MULTI_ORG environment variable.",
    );
  }

  // If there is no license it can't have a different license error
  // Licenses might not have a plan if sign up for pro, but abandon checkout, in which case we don't want to show an error
  // Or it might not have a plan if the license is set in the env var but the license server wasn't whitelisted, in which case we do want to show the error
  if (!licenseData || !licenseData.plan) {
    if (licenseData?.lastServerErrorMessage?.includes("Could not connect")) {
      return "License server unreachable for too long";
    } else if (licenseData?.lastServerErrorMessage) {
      return "License server erroring for too long";
    }
    return "";
  }

  if (licenseData.usingMongoCache && licenseData.dateUpdated) {
    const dateUpdated = new Date(licenseData.dateUpdated);

    let cachedDataGoodUntil = new Date(
      dateUpdated.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    if (
      licenseData.firstFailedFetchDate &&
      licenseData.firstFailedFetchDate < cachedDataGoodUntil
    ) {
      // As long as the first failed fetch date is within the last week, we allow the cache to be used for seven days from the first failed fetch
      cachedDataGoodUntil = new Date(
        licenseData.firstFailedFetchDate.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
    }

    if (new Date() > cachedDataGoodUntil) {
      if (
        !licenseData?.lastServerErrorMessage ||
        licenseData?.lastServerErrorMessage?.includes("Could not connect")
      ) {
        return "License server unreachable for too long";
      } else {
        return "License server erroring for too long";
      }
    }
  }

  if (shouldLimitAccessDueToExpiredLicense(licenseData)) {
    return "License expired";
  }

  if (!isAirGappedLicenseKey(key) && !licenseData.emailVerified) {
    return "Email not verified";
  }

  if (
    org.id &&
    licenseData?.organizationId &&
    org.id !== licenseData.organizationId
  ) {
    return "Invalid license";
  }

  if (
    licenseData?.remoteDowngrade ||
    (isAirGappedLicenseKey(key) && isForbiddenAirGappedLicenseKey(key))
  ) {
    return "License invalidated";
  }

  return "";
}

export function isAirGappedLicenseKey(licenseKey: string | undefined): boolean {
  if (!licenseKey) return false;
  return !licenseKey.startsWith("license");
}

export function getEffectiveAccountPlan(org: MinimalOrganization): AccountPlan {
  let basicPlan: AccountPlan;

  if (stringToBoolean(process.env.IS_CLOUD)) {
    if (!org.licenseKey) {
      return getAccountPlan(org);
    }
    basicPlan = "starter";
  } else {
    basicPlan = "oss";
  }

  const hasError = getLicenseError(org);
  if (hasError) {
    return basicPlan;
  }

  const license = getLicense(org.licenseKey);
  if (!license?.plan || !accountPlans.has(license?.plan)) {
    return basicPlan;
  }

  return license.plan;
}

/**
 * Checks if the license is expired.
 * @returns {boolean} True if the license is expired, false otherwise.
 */
function shouldLimitAccessDueToExpiredLicense(
  licenseData: Partial<LicenseInterface>,
): boolean {
  // If licenseData is not available, consider it as not expired
  if (!licenseData) {
    return false;
  }

  // Limit access if it is a pro or pro_sso license and it has been canceled regardless of the dateExpires.
  // (If a payment failed stripe will cancel the subscription but the dateExpires will still be in the future.)
  const subscription = getSubscriptionFromLicense(licenseData);
  if (
    ["pro", "pro_sso"].includes(licenseData.plan || "") &&
    subscription?.status === "canceled"
  ) {
    return true;
  }

  // Limit access if it is a trial, or a remote downgraded enterprise license and it has expired
  if (
    (licenseData.isTrial || licenseData.remoteDowngrade) &&
    licenseData.dateExpires
  ) {
    const expirationDate = new Date(licenseData.dateExpires);

    if (expirationDate < new Date()) {
      // The license is expired
      return true;
    }
  }

  // The license is not expired
  return false;
}
