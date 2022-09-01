import crypto from "crypto";

import { LICENCE_KEY } from "../util/secrets";

export type LicenceData = {
  ref: string;
  sub: string;
  qty: string;
  iat: string;
  eat: string;
};

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

  // If the public key failed to load, just assume the licence is valid
  const publicKey = await getPublicKey();
  if (!publicKey) return decodedLicence;

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
    console.error("Licence key signature invalid", decodedLicence);
    return null;
  }

  return decodedLicence;
}
