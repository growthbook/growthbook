import crypto from "crypto";
import fetch from "node-fetch";
import { LicenceData } from "../../types/organization";

import { LICENCE_KEY } from "../util/secrets";

let licenceData: LicenceData | null = null;
export default async () => {
  if (!LICENCE_KEY) return;
  licenceData = await getVerifiedLicenceData(LICENCE_KEY);
};

export function getLicence() {
  return licenceData;
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
      "https://cdn.growthbook.io/licence_public_key.pem",
      {
        signal: controller.signal,
      }
    );
    publicKey = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error(
      "Failed to load GrowthBook public key for licence verification",
      e
    );
  }

  clearTimeout(timeout);
  return publicKey;
}

async function getVerifiedLicenceData(key: string) {
  const [licence, signature] = key
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));

  const decodedLicence: LicenceData = JSON.parse(licence.toString());

  // If it's a trial licence key, make sure it's not expired yet
  // For real licence keys, we show an "expired" banner in the app instead of throwing an error
  // We want to be strict for trial keys, but lenient for real Enterprise customers
  if (decodedLicence.trial && decodedLicence.eat < new Date().toISOString()) {
    throw new Error(
      `Your Enterprise Licence Key trial expired on ${decodedLicence.eat}.`
    );
  }

  // If the public key failed to load, just assume the licence is valid
  const publicKey = await getPublicKey();
  if (!publicKey) {
    console.log(
      "Could not contact licence verification server",
      decodedLicence
    );
    return decodedLicence;
  }

  const isVerified = crypto.verify(
    "sha256",
    licence,
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    },
    signature
  );

  // Licence key signature is invalid, don't use it
  if (!isVerified) {
    throw new Error("Invalid licence key signature");
  }

  console.log("Using verified licence key", decodedLicence);

  return decodedLicence;
}
