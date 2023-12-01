import crypto from "crypto";
import fetch from "node-fetch";
import type Stripe from "stripe";
import pino from "pino";
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
  | "no_access_role"
  | "teams";
export type CommercialFeaturesMap = Record<AccountPlan, Set<CommercialFeature>>;

export type LicenseData = {
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
    "custom-launch-checklist",
    "no_access_role",
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

export async function getVerifiedLicenseData(key: string) {
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

  // If the public key failed to load, just assume the license is valid
  const publicKey = await getPublicKey();
  if (!publicKey) {
    logger.warn(
      decodedLicense,
      "Could not contact license verification server"
    );
    return decodedLicense;
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

  return decodedLicense;
}

let licenseData: LicenseData | null = null;
// in-memory cache to avoid hitting the license server on every request
const keyToLicenseData: Record<string, LicenseData> = {};

export async function licenseInit(licenseKey?: string) {
  const key = licenseKey || LICENSE_KEY || null;

  if (!key) {
    licenseData = null;
    return;
  }

  if (key && keyToLicenseData[key]) return keyToLicenseData[key];

  licenseData = await getVerifiedLicenseData(key);
  keyToLicenseData[key] = licenseData;
}

export function getLicense() {
  return licenseData;
}
export async function setLicense(l: LicenseData | null) {
  // make sure we trust that l is already verified before setting:
  licenseData = l;
}
