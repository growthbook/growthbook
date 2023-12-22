import crypto from "crypto";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import type Stripe from "stripe";
import pino from "pino";
import { omit, sortBy } from "lodash";
import AsyncLock from "async-lock";
import { LicenseDocument, LicenseModel } from "./models/licenseModel";

export const LICENSE_SERVER =
  "https://central_license_server.growthbook.io/api/v1/";

const logger = pino();

export type AccountPlan = "oss" | "starter" | "pro" | "pro_sso" | "enterprise";
export type CommercialFeature =
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
  | "teams";
export type CommercialFeaturesMap = Record<AccountPlan, Set<CommercialFeature>>;

export interface LicenseInterface {
  id: string; // Unique ID for the license key
  companyName: string; // Name of the organization on the license
  organizationId?: string; // OrganizationId (keys prior to 12/2022 do not contain this field)
  seats: number; // Maximum number of seats on the license
  dateCreated: string; // Date the license was issued
  dateExpires: string; // Date the license expires
  isTrial: boolean; // True if this is a trial license
  plan: AccountPlan; // The plan (pro, enterprise, etc.) for this license
  seatsInUse: number; // Number of seats currently in use
  installationUsers: {
    [installationId: string]: { date: string; userHashes: string[] };
  }; // Map of first 7 chars of user email shas to the last time they were in a usage request
  archived: boolean; // True if this license has been deleted/archived
  dateUpdated: string; // Date the license was last updated
  signedChecksum: string; // Checksum of the license data signed with the private key
}

// Old style license keys where the license data is encrypted in the key itself
type LicenseData = {
  // Unique id for the license key
  ref: string;
  // Name of organization on the license
  sub: string;
  // Organization ID (keys prior to 12/2022 do not contain this field)
  org?: string;
  // Max number of seats
  qty: number;
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
  ]),
  enterprise: new Set<CommercialFeature>([
    "sso",
    "advanced-permissions",
    "audit-logging",
    "encrypt-features-endpoint",
    "schedule-feature-flag",
    "override-metrics",
    "regression-adjustment",
    "sequential-testing",
    "pipeline-mode",
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
  ]),
};

type MinimalOrganization = {
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

export function getAccountPlan(org: MinimalOrganization): AccountPlan {
  if (process.env.IS_CLOUD) {
    if (org.enterprise) return "enterprise";
    if (org.restrictAuthSubPrefix || org.restrictLoginMethod) return "pro_sso";
    if (isActiveSubscriptionStatus(org.subscription?.status)) return "pro";
    return "starter";
  }

  // For self-hosted deployments
  return getLicense()?.plan || "oss";
}
export function planHasPremiumFeature(
  plan: AccountPlan,
  feature: CommercialFeature
): boolean {
  return accountFeatures[plan].has(feature);
}
export function orgHasPremiumFeature(
  org: MinimalOrganization,
  feature: CommercialFeature
): boolean {
  return planHasPremiumFeature(getAccountPlan(org), feature);
}

async function getPublicKey(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(
      path.join(__dirname, "..", "license_public_key.pem"),
      (err, data) => {
        if (err) {
          logger.error(
            "Failed to find Growthbook public key file for license verification"
          );
          reject(err);
        } else {
          resolve(data);
        }
      }
    );
  });
}

export async function getVerifiedLicenseData(
  key: string
): Promise<Partial<LicenseInterface>> {
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

  // If it's a trial license key, make sure it's not expired yet
  // For real license keys, we show an "expired" banner in the app instead of throwing an error
  // We want to be strict for trial keys, but lenient for real Enterprise customers
  if (decodedLicense.trial && decodedLicense.exp < new Date().toISOString()) {
    throw new Error(`Your License Key trial expired on ${decodedLicense.exp}.`);
  }

  // We used to only offer license keys for Enterprise plans (not pro)
  if (!decodedLicense.plan) {
    decodedLicense.plan = "enterprise";
  }
  // Trying to use SSO, but the plan doesn't support it
  if (
    process.env.SSO_CONFIG &&
    !planHasPremiumFeature(decodedLicense.plan, "sso")
  ) {
    throw new Error(`Your License Key does not support SSO.`);
  }
  // Trying to use IS_MULTI_ORG, but the plan doesn't support it
  if (
    process.env.IS_MULTI_ORG &&
    !planHasPremiumFeature(decodedLicense.plan, "multi-org")
  ) {
    throw new Error(
      `Your License Key does not support multiple organizations.`
    );
  }

  const convertedLicense: Partial<LicenseInterface> = {
    id: decodedLicense.ref,
    companyName: decodedLicense.sub,
    organizationId: decodedLicense.org,
    seats: decodedLicense.qty,
    dateCreated: decodedLicense.iat,
    dateExpires: decodedLicense.exp,
    isTrial: decodedLicense.trial,
    plan: decodedLicense.plan,
  };

  // If the public key failed to load, just assume the license is valid
  const publicKey = await getPublicKey();

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

function checkIfEnvVarSettingsAreAllowedByLicense(license: LicenseInterface) {
  // Trying to use SSO, but the plan doesn't support it
  if (process.env.SSO_CONFIG && !planHasPremiumFeature(license.plan, "sso")) {
    throw new Error(`Your License Key does not support SSO.`);
  }
  // Trying to use IS_MULTI_ORG, but the plan doesn't support it
  if (
    process.env.IS_MULTI_ORG &&
    !planHasPremiumFeature(license.plan, "multi-org")
  ) {
    throw new Error(
      `Your License Key does not support multiple organizations.`
    );
  }
}

async function getLicenseDataFromMongoCache(
  cache: LicenseDocument | null
): Promise<LicenseInterface> {
  if (!cache) {
    throw new Error(
      "License server is not working and no cached license data exists"
    );
  }
  if (
    new Date(cache.dateUpdated) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days
  ) {
    // If the public key failed to load, just assume the license is valid
    const publicKey = await getPublicKey();

    const licenseInterface = omit(cache.toJSON(), ["__v", "_id"]);

    // In order to verify the license key, we need to strip out the fields that are not part of the license data
    // and sort the fields alphabetically as we do on the license server itself.
    const strippedLicense = omit(licenseInterface, ["signedChecksum"]);
    const data = Object.fromEntries(sortBy(Object.entries(strippedLicense)));
    const dataBuffer = Buffer.from(JSON.stringify(data));

    const signature = Buffer.from(cache.signedChecksum, "base64url");

    logger.info("Verifying cached license data: " + JSON.stringify(data));
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
      throw new Error("Cached Invalid license key signature");
    }

    checkIfEnvVarSettingsAreAllowedByLicense(cache);
    logger.info("Using cached license data");
    return licenseInterface as LicenseInterface;
  }
  throw new Error(
    "License server is not working and cached license data is too old"
  );
}

async function getLicenseDataFromServer(
  licenseId: string,
  userLicenseCodes: string[],
  metaData: LicenseMetaData
): Promise<LicenseInterface> {
  logger.info("Getting license data from server for " + licenseId);
  const url = `${LICENSE_SERVER}license/${licenseId}/check`;
  const options = {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userHashes: userLicenseCodes,
      metaData,
    }),
  };

  let serverResult;

  const currentCache = await LicenseModel.findOne({ id: licenseId });

  try {
    serverResult = await fetch(url, options);
  } catch (e) {
    logger.warn("Could not connect to license server. Falling back to cache.");
    return getLicenseDataFromMongoCache(currentCache);
  }

  if (!serverResult.ok) {
    logger.warn(
      `Falling back to LicenseModel cache because the license server threw a ${serverResult.status} error: ${serverResult.statusText}.`
    );
    return getLicenseDataFromMongoCache(currentCache);
  }

  const licenseData = await serverResult.json();

  if (!currentCache) {
    // Create a cached version of the license key in case the license server goes down.
    logger.info("Creating new license cache");
    await LicenseModel.create(licenseData);
  } else {
    // Update the cached version of the license key in case the license server goes down.
    logger.info("Updating license cache");
    currentCache.set(licenseData);
    await currentCache.save();
  }

  checkIfEnvVarSettingsAreAllowedByLicense(licenseData);
  return licenseData;
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
let licenseData: Partial<LicenseInterface> | null = null;
let cacheDate: Date | null = null;
// in-memory cache to avoid hitting the license server on every request
const keyToLicenseData: Record<string, Partial<LicenseInterface>> = {};

export async function licenseInit(
  licenseKey?: string,
  userLicenseCodes?: string[],
  metaData?: LicenseMetaData,
  forceRefresh = false
) {
  const key = licenseKey || process.env.LICENSE_KEY || null;

  if (!key) {
    licenseData = null;
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // When hitting a page for a new license we often make many simulataneous requests
  // By acquiring a lock we make sure to only call the license server once, the remaining
  // calls will be able to read from the cache.
  await lock.acquire(key, async () => {
    if (
      !forceRefresh &&
      key &&
      keyToLicenseData[key] &&
      (cacheDate === null || cacheDate > oneDayAgo)
    ) {
      licenseData = keyToLicenseData[key];
    } else if (key.startsWith("license_") && userLicenseCodes && metaData) {
      licenseData = await getLicenseDataFromServer(
        key,
        userLicenseCodes,
        metaData
      );
      cacheDate = new Date();
    } else {
      // Old style: the key itself has the encrypted license data in it.
      licenseData = await getVerifiedLicenseData(key);
    }

    keyToLicenseData[key] = licenseData;
  });

  return keyToLicenseData[key];
}

export function getLicense() {
  return licenseData;
}
export async function setLicense(l: Partial<LicenseInterface> | null) {
  // make sure we trust that l is already verified before setting:
  licenseData = l;
}

export function resetInMemoryLicenseCache(): void {
  licenseData = null;
  cacheDate = null;
  Object.keys(keyToLicenseData).forEach((key) => {
    delete keyToLicenseData[key];
  });
}
