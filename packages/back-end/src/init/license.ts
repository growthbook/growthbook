import crypto from "crypto";
import fetch from "node-fetch";
import { LicenseData } from "../../types/organization";
import { logger } from "../util/logger";
import { planHasPremiumFeature } from "../util/organization.util";

import { LICENSE_KEY, SSO_CONFIG } from "../util/secrets";

let licenseData: LicenseData | null = null;

export default async (licenseKey?: string) => {
  const key = licenseKey || LICENSE_KEY || null;
  if (!key) {
    licenseData = null;
    return;
  }
  licenseData = await getVerifiedLicenseData(key);
};

export function getLicense() {
  return licenseData;
}
export async function setLicense(l: LicenseData | null) {
  // make sure we trust that l is already verified before setting:
  licenseData = l;
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

async function getVerifiedLicenseData(key: string) {
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
  if (SSO_CONFIG && !planHasPremiumFeature(decodedLicense.plan, "sso")) {
    throw new Error(`Your License Key does not support SSO.`);
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
