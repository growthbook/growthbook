import crypto from "crypto";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import type Stripe from "stripe";
import pino from "pino";
import { pick, sortBy } from "lodash";
import AsyncLock from "async-lock";
import { stringToBoolean } from "shared/util";
import { ProxyAgent } from "proxy-agent";
import { LicenseDocument, LicenseModel } from "./models/licenseModel";

export const LICENSE_SERVER_URL =
  process.env.LICENSE_SERVER_URL ||
  "https://central_license_server.growthbook.io/api/v1/";

const logger = pino();

export type AccountPlan = "oss" | "starter" | "pro" | "pro_sso" | "enterprise";
const accountPlans: Set<AccountPlan> = new Set([
  "oss",
  "starter",
  "pro",
  "pro_sso",
  "enterprise",
]);

export type CommercialFeature =
  | "scim"
  | "sso"
  | "advanced-permissions"
  | "encrypt-features-endpoint"
  | "schedule-feature-flag"
  | "override-metrics"
  | "regression-adjustment"
  | "sequential-testing"
  | "pipeline-mode"
  | "audit-logging"
  | "visual-editor"
  | "archetypes"
  | "cloud-proxy"
  | "hash-secure-attributes"
  | "livechat"
  | "json-validation"
  | "remote-evaluation"
  | "multi-org"
  | "custom-launch-checklist"
  | "multi-metric-queries"
  | "no-access-role"
  | "teams"
  | "sticky-bucketing"
  | "require-approvals"
  | "code-references"
  | "prerequisites"
  | "prerequisite-targeting"
  | "redirects"
  | "multiple-sdk-webhooks"
  | "quantile-metrics";
export type CommercialFeaturesMap = Record<AccountPlan, Set<CommercialFeature>>;

export interface LicenseInterface {
  id: string; // Unique ID for the license key
  companyName: string; // Name of the organization on the license
  organizationId?: string; // OrganizationId (keys prior to 12/2022 do not contain this field)
  seats: number; // Maximum number of seats on the license
  hardCap: boolean; // True if this license has a hard cap on the number of seats
  dateCreated: string; // Date the license was issued
  dateExpires: string; // Date the license expires
  name: string; // Name of the person who signed up for the license
  email: string; // Billing email of the person who signed up for the license
  emailVerified: boolean; // True if the email has been verified
  isTrial: boolean; // True if this is a trial license
  plan: AccountPlan; // The assigned plan (pro, enterprise, etc.) for this license
  seatsInUse: number; // Number of seats currently in use
  remoteDowngrade: boolean; // True if the license was downgraded remotely
  message?: {
    text: string; // The text to show in the account notice
    className: string; // The class name to apply to the account notice
    tooltipText: string; // The text to show in the tooltip
    showAllUsers: boolean; // True if all users should see the notice rather than just the admins
  };
  stripeSubscription?: {
    id: string;
    qty: number;
    trialEnd: Date | null;
    status: Stripe.Subscription.Status;
    current_period_end: number;
    cancel_at: number | null;
    canceled_at: number | null;
    cancel_at_period_end: boolean;
    planNickname: string | null;
    priceId?: string;
    price?: number; // The price of the license
    discountAmount?: number; // The amount of the discount
    discountMessage?: string; // The message of the discount
    hasPaymentMethod?: boolean;
  };
  freeTrialDate?: Date; // Date the free trial was started
  installationUsers: {
    [installationId: string]: { date: string; userHashes: string[] };
  }; // Map of first 7 chars of user email shas to the last time they were in a usage request
  archived: boolean; // True if this license has been deleted/archived
  dateUpdated: string; // Date the license was last updated
  usingMongoCache: boolean; // True if the license data was retrieved from the cache
  firstFailedFetchDate?: Date; // Date of the first failed fetch
  lastFailedFetchDate?: Date; // Date of the last failed fetch
  lastServerErrorMessage?: string; // The last error message from a failed fetch
  signedChecksum: string; // Checksum of the license data signed with the private key
}

// Old/Airgapped style license keys where the license data is encrypted in the key itself
type LicenseData = {
  // Unique id for the license key
  ref: string;
  // Name of organization on the license
  sub: string;
  // Organization ID (keys prior to 12/2022 do not contain this field)
  org?: string;
  // Max number of seats
  qty: number;
  // True if this license has a hard cap on the number of seats (keys prior to 03/2024 do not contain this field)
  hardCap?: boolean;
  // Date issued
  iat: string;
  // Expiration date
  exp: string;
  // If it's a trial or not
  trial: boolean;
  // The plan (pro, enterprise, etc.)
  plan: AccountPlan;
  /**
   * Expiration date (old style)
   * @deprecated
   */
  eat?: string;
};

export const accountFeatures: CommercialFeaturesMap = {
  oss: new Set<CommercialFeature>([]),
  starter: new Set<CommercialFeature>([]),
  pro: new Set<CommercialFeature>([
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "visual-editor",
    "archetypes",
    "cloud-proxy",
    "hash-secure-attributes",
    "livechat",
    "remote-evaluation",
    "sticky-bucketing",
    "code-references",
    "prerequisites",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
  ]),
  pro_sso: new Set<CommercialFeature>([
    "sso",
    "advanced-permissions",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "visual-editor",
    "archetypes",
    "cloud-proxy",
    "hash-secure-attributes",
    "livechat",
    "remote-evaluation",
    "sticky-bucketing",
    "code-references",
    "prerequisites",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
  ]),
  enterprise: new Set<CommercialFeature>([
    "scim",
    "sso",
    "advanced-permissions",
    "audit-logging",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "pipeline-mode",
    "multi-metric-queries",
    "visual-editor",
    "archetypes",
    "cloud-proxy",
    "hash-secure-attributes",
    "json-validation",
    "livechat",
    "remote-evaluation",
    "multi-org",
    "teams",
    "custom-launch-checklist",
    "no-access-role",
    "sticky-bucketing",
    "require-approvals",
    "code-references",
    "prerequisites",
    "prerequisite-targeting",
    "redirects",
    "multiple-sdk-webhooks",
    "quantile-metrics",
  ]),
};

type MinimalOrganization = {
  id: string;
  licenseKey?: string;
  enterprise?: boolean;
  restrictAuthSubPrefix?: string;
  restrictLoginMethod?: string;
  subscription?: {
    status: Stripe.Subscription.Status;
  };
};

export function isActiveSubscriptionStatus(
  status?: Stripe.Subscription.Status
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
    if (org.enterprise) return "enterprise";
    if (org.restrictAuthSubPrefix || org.restrictLoginMethod) return "pro_sso";
    if (isActiveSubscriptionStatus(org.subscription?.status)) return "pro";
    return "starter";
  }

  // For self-hosted deployments
  return getLicense(org.licenseKey)?.plan || "oss";
}

function planHasPremiumFeature(
  plan: AccountPlan,
  feature: CommercialFeature
): boolean {
  return accountFeatures[plan].has(feature);
}

export function orgHasPremiumFeature(
  org: MinimalOrganization,
  feature: CommercialFeature
): boolean {
  return planHasPremiumFeature(getEffectiveAccountPlan(org), feature);
}

function getPublicKey(): Buffer {
  try {
    const data = fs.readFileSync(
      path.join(__dirname, "..", "license_public_key.pem")
    );
    return data;
  } catch (err) {
    logger.error(
      "Failed to find Growthbook public key file for license verification"
    );
    throw err;
  }
}

function getVerifiedLicenseData(key: string): Partial<LicenseInterface> {
  const [license, signature] = key
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));

  const decodedLicense: LicenseData = JSON.parse(license.toString());

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
    signature
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
    signature
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

async function callLicenseServer(url: string, body: string, method = "POST") {
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
      "Could not connect to license server. Make sure to whitelist 75.2.109.47."
    );
    throw new LicenseServerError(
      "Could not connect to license server. Make sure to whitelist 75.2.109.47.",
      500
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
      serverResult.status
    );
  }

  return await serverResult.json();
}

export async function postVerifyEmailToLicenseServer(
  emailVerificationToken: string
) {
  const url = `${LICENSE_SERVER_URL}license/verify-email`;
  return callLicenseServer(
    url,
    JSON.stringify({
      emailVerificationToken,
    })
  );
}

export async function postNewProTrialSubscriptionToLicenseServer(
  organizationId: string,
  companyName: string,
  name: string,
  email: string,
  seats: number
) {
  const url = `${LICENSE_SERVER_URL}subscription/new-pro-trial`;
  return callLicenseServer(
    url,
    JSON.stringify({
      organizationId,
      companyName,
      name,
      email,
      seats,
      appOrigin: process.env.APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
}

export async function postNewProSubscriptionToLicenseServer(
  organizationId: string,
  companyName: string,
  ownerEmail: string,
  name: string,
  seats: number,
  returnUrl: string
) {
  const url = `${LICENSE_SERVER_URL}subscription/new`;
  return callLicenseServer(
    url,
    JSON.stringify({
      appOrigin: process.env.APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
      organizationId,
      companyName,
      ownerEmail,
      name,
      seats,
      returnUrl,
    })
  );
}

export async function postNewSubscriptionSuccessToLicenseServer(
  checkoutSessionId: string
): Promise<LicenseInterface> {
  const url = `${LICENSE_SERVER_URL}subscription/success`;
  return await callLicenseServer(
    url,
    JSON.stringify({
      checkoutSessionId,
    })
  );
}

export async function postCreateBillingSessionToLicenseServer(
  licenseId: string
): Promise<{ url: string; status: number }> {
  const url = `${LICENSE_SERVER_URL}subscription/manage`;
  return await callLicenseServer(
    url,
    JSON.stringify({
      appOrigin: process.env.APP_ORIGIN,
      licenseId,
    })
  );
}

export async function postSubscriptionUpdateToLicenseServer(
  licenseId: string,
  seats: number
): Promise<LicenseInterface> {
  const url = `${LICENSE_SERVER_URL}subscription/update`;
  const license = await callLicenseServer(
    url,
    JSON.stringify({
      licenseId,
      seats,
    })
  );

  setAndVerifyServerLicenseData(license);
  return license;
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
  }
) {
  const url = `${LICENSE_SERVER_URL}license/new-enterprise-trial`;
  return await callLicenseServer(
    url,
    JSON.stringify({
      email,
      name,
      organizationId,
      companyName,
      context,
      appOrigin: process.env.APP_ORIGIN,
      cloudSecret: process.env.CLOUD_SECRET,
    })
  );
}

export async function postResendEmailVerificationEmailToLicenseServer(
  organizationId: string
) {
  const url = `${LICENSE_SERVER_URL}license/resend-license-email`;
  return await callLicenseServer(
    url,
    JSON.stringify({
      organizationId,
      appOrigin: process.env.APP_ORIGIN,
    })
  );
}

// Creates or updates the license in the MongoDB cache in case the license server goes down.
async function createOrUpdateLicenseMongoCache(license: LicenseInterface) {
  await LicenseModel.findOneAndUpdate(
    { id: license.id },
    { $set: license },
    { upsert: true }
  );
}

// Updates the local daily cache, the one week backup Mongo cache, and verifies the license.
export function setAndVerifyServerLicenseData(license: LicenseInterface) {
  verifyLicenseInterface(license);
  keyToLicenseData[license.id] = license;
  keyToCacheDate[license.id] = new Date();
  createOrUpdateLicenseMongoCache(license).catch((e) => {
    logger.error(`Error creating mongo cache: ${e}`);
    throw e;
  });
}

async function getLicenseDataFromServer(
  licenseId: string,
  userLicenseCodes: string[],
  metaData: LicenseMetaData
): Promise<LicenseInterface> {
  logger.info("Getting license data from server for " + licenseId);
  const url = `${LICENSE_SERVER_URL}license/${licenseId}/check`;

  const license = await callLicenseServer(
    url,
    JSON.stringify({
      userHashes: userLicenseCodes,
      metaData,
    }),
    "PUT"
  );

  return license;
}

async function updateLicenseFromServer(
  licenseKey: string,
  userLicenseCodes: string[],
  metaData: LicenseMetaData,
  mongoCache?: LicenseDocument | null
) {
  let license: LicenseInterface;
  try {
    license = await getLicenseDataFromServer(
      licenseKey,
      userLicenseCodes,
      metaData
    );
    createOrUpdateLicenseMongoCache(license).catch((e) => {
      logger.error(`Error creating mongo cache: ${e}`);
      throw e;
    });
  } catch (e) {
    // attach error data to the cache so we know how long the server has been down for
    const now = new Date();
    if (mongoCache === undefined) {
      // We haven't fetched the chache yet
      mongoCache = await LicenseModel.findOne({ id: licenseKey });
    }
    if (mongoCache === null) {
      // We have fetched the cache, but it doesn't exist
      license = new LicenseModel({
        id: licenseKey,
        firstFailedFetchDate: now,
      });
    } else {
      // At this point we know the cache exists and can't be undefined, but TS doesn't, hence the !.
      license = mongoCache!;
      if (!license.firstFailedFetchDate) {
        license.firstFailedFetchDate = now;
      }
    }
    license.lastFailedFetchDate = now;
    license.lastServerErrorMessage = e.message;
    license.usingMongoCache = true;
    createOrUpdateLicenseMongoCache(license).catch((e) => {
      logger.error(`Error creating mongo cache: ${e}`);
      throw e;
    });
    throw e;
  }
  return license;
}

export interface LicenseMetaData {
  installationId: string;
  gitSha: string;
  gitCommitDate: string;
  sdkLanguages: string[];
  dataSourceTypes: string[];
  eventTrackers: string[];
  isCloud: boolean;
}

const lock = new AsyncLock();

// in-memory cache to avoid hitting the license server on every request
const keyToLicenseData: Record<string, Partial<LicenseInterface>> = {};
const keyToCacheDate: Record<string, Date> = {};

export let backgroundUpdateLicenseFromServerForTests: Promise<void | LicenseInterface>;

export async function licenseInit(
  licenseKey?: string,
  userLicenseCodes?: string[],
  metaData?: LicenseMetaData,
  forceRefresh = false
): Promise<Partial<LicenseInterface> | undefined> {
  const key = licenseKey || process.env.LICENSE_KEY || null;

  if (!key) {
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

  // When hitting a page for a new license we often make many simulataneous requests
  // By acquiring a lock we make sure to only call the license server once, the remaining
  // calls will be able to read from the cache.
  await lock.acquire(key, async () => {
    try {
      // Only refetch the license data if forceRefresh is true
      // or if the license data is not in the cache
      // or if the cache date exists and is older than 1 day
      if (
        forceRefresh ||
        !keyToLicenseData[key] ||
        (keyToCacheDate[key] !== null && keyToCacheDate[key] <= oneMinuteAgo)
      ) {
        if (!isAirGappedLicenseKey(key)) {
          if (!userLicenseCodes || !metaData) {
            throw new Error(
              "Missing userLicenseCodes or metaData for license key"
            );
          }

          let license: LicenseInterface;
          const mongoCache = await LicenseModel.findOne({ id: key });
          const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (
            forceRefresh ||
            !mongoCache ||
            new Date(mongoCache.dateUpdated) < oneWeekAgo
          ) {
            license = await updateLicenseFromServer(
              key,
              userLicenseCodes,
              metaData,
              mongoCache
            );
          } else {
            // Use the cache
            license = mongoCache.toJSON();
            license.usingMongoCache = true;
            if (new Date(mongoCache.dateUpdated) < oneDayAgo) {
              // But if it is older than a day update it in the background
              backgroundUpdateLicenseFromServerForTests = updateLicenseFromServer(
                key,
                userLicenseCodes,
                metaData,
                mongoCache
              ).catch((e) => {
                logger.error(
                  `Failed to update license ${key} in the background: ${e}`
                );
              });
            }
          }

          verifyLicenseInterface(license);
          keyToLicenseData[key] = license;
          keyToCacheDate[key] = new Date();
        } else {
          // Old style: the key itself has the encrypted license data in it.
          keyToLicenseData[key] = getVerifiedLicenseData(key);
        }
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

  // If an organization replaces an expired org.licenseKey with an env var
  // for license key that is not expired, use the env var license key instead.
  if (
    process.env.LICENSE_KEY &&
    key != process.env.LICENSE_KEY &&
    new Date(keyToLicenseData[key]?.dateExpires || "") < new Date()
  ) {
    const result = await licenseInit(
      process.env.LICENSE_KEY,
      userLicenseCodes,
      metaData,
      forceRefresh
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

  // If there is no license it can't have an error
  // Licenses might not have a plan if sign up for pro, but abandon checkout
  // Or it might not have a plan if the license is set in the env var but the license server wasn't whitelisted.
  if (!licenseData || !licenseData.plan) {
    return "";
  }

  if (licenseData.usingMongoCache && licenseData.dateUpdated) {
    const dateUpdated = new Date(licenseData.dateUpdated);

    let cachedDataGoodUntil = new Date(
      dateUpdated.getTime() + 7 * 24 * 60 * 60 * 1000
    );
    if (
      licenseData.firstFailedFetchDate &&
      licenseData.firstFailedFetchDate < cachedDataGoodUntil
    ) {
      // As long as the first failed fetch date is within the last week, we allow the cache to be used for seven days from the first failed fetch
      cachedDataGoodUntil = new Date(
        licenseData.firstFailedFetchDate.getTime() + 7 * 24 * 60 * 60 * 1000
      );
    }

    if (new Date() > cachedDataGoodUntil) {
      return "License server down for too long";
    }
  }

  if (
    !stringToBoolean(process.env.IS_CLOUD) &&
    process.env.SSO_CONFIG &&
    !planHasPremiumFeature(licenseData.plan, "sso")
  ) {
    // Trying to use SSO, but the plan doesn't support it
    // We throw the error here, otherwise they would still be able to use SSO on free plans with only a warning.
    throw new Error(
      "Your license does not support SSO. Either upgrade to enterprise or remove SSO_CONFIG environment variable."
    );
  }

  if (
    !stringToBoolean(process.env.IS_CLOUD) &&
    stringToBoolean(process.env.IS_MULTI_ORG) &&
    !planHasPremiumFeature(licenseData.plan, "multi-org")
  ) {
    // Trying to use IS_MULTI_ORG, but the plan doesn't support it
    return "No support for multi-org";
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

  if (licenseData?.remoteDowngrade) {
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
  licenseData: Partial<LicenseInterface>
): boolean {
  // If licenseData is not available, consider it as not expired
  if (!licenseData) {
    return false;
  }

  // Limit access if it is a pro or pro_sso license and it has been canceled regardless of the dateExpires.
  // (If a payment failed stripe will cancel the subscription but the dateExpires will still be in the future.)
  if (
    ["pro", "pro_sso"].includes(licenseData.plan || "") &&
    licenseData.stripeSubscription?.status === "canceled"
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
