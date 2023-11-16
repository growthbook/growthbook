import crypto from "crypto";
import fetch from "node-fetch";
import type Stripe from "stripe";
import pino from "pino";

//TODO: Set this to the real prod license server
const LICENSE_SERVER = "http://localhost:8080";
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

// Self-hosted commercial license key
const LICENSE_KEY = process.env.LICENSE_KEY || "";

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

async function getPublicKey() {
  // Timeout after 3 seconds of waiting for the public key to load
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 3000);

  let publicKey: Buffer | null = null;
  try {
    const res = await fetch(
      "https://cdn.growthbook.io/license_public_key.pem",
      {
        signal: controller.signal,
      }
    );
    publicKey = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    logger.error(
      e,
      "Failed to load GrowthBook public key for license verification"
    );
  }

  clearTimeout(timeout);
  return publicKey;
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
  if (!publicKey) {
    logger.warn(
      convertedLicense,
      "Could not contact license verification server"
    );
    return convertedLicense;
  }

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

let licenseData: Partial<LicenseInterface> | null = null;
let cacheDate: Date | null = null;
// in-memory cache to avoid hitting the license server on every request
const keyToLicenseData: Record<string, Partial<LicenseInterface>> = {};

async function getLicenseDataFromServer(
  licenseId: string,
  userLicenseCodes: string[],
  metaData: LicenseMetaData
): Promise<LicenseInterface> {
  const url = `${LICENSE_SERVER}/api/v1/license/${licenseId}/check`;
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

  try {
    serverResult = await fetch(url, options);
  } catch (e) {
    throw new Error("Could not connect to license server");
  }

  if (!serverResult.ok) {
    throw new Error("Invalid license key");
  }

  return await serverResult.json();
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

export async function licenseInit(
  userLicenseCodes: string[],
  metaData: LicenseMetaData,
  licenseKey?: string
) {
  const key = licenseKey || LICENSE_KEY || null;

  if (!key) {
    licenseData = null;
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (
    key &&
    keyToLicenseData[key] &&
    (cacheDate === null || cacheDate > oneDayAgo)
  ) {
    return keyToLicenseData[key];
  }

  if (key.startsWith("license_")) {
    licenseData = await getLicenseDataFromServer(
      key,
      userLicenseCodes,
      metaData
    );
    cacheDate = new Date(Date.now());
  } else {
    // Old style: the key itself has the encrypted license data in it.
    licenseData = await getVerifiedLicenseData(key);
  }

  keyToLicenseData[key] = licenseData;
}

export function getLicense() {
  return licenseData;
}
export async function setLicense(l: Partial<LicenseInterface> | null) {
  // make sure we trust that l is already verified before setting:
  licenseData = l;
}
