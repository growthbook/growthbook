import { verify, sign } from "crypto";

const PUBLIC_KEY = "abcdef";
const LICENSE_PRIVATE_KEY = process.env.LICENSE_PRIVATE_KEY || "";

export type CompressedLicenseData = {
  // Owner Name
  o: string;
  // Issue Date
  i: number;
  // Expire Date
  e: number;
  // Number of user seats
  u: number;
};

export type LicenseData = {
  owner: string;
  issued_at: Date;
  expires_at: Date;
  user_seats: number;
};

const licenseMap: Map<string, LicenseData> = new Map();

export function validateLicense(license?: string): LicenseData | undefined {
  license = license || process.env.GB_LICENSE;

  if (!license) return;

  if (!licenseMap.has(license)) {
    const [signature, data] = license.split(";", 2);
    const res = verify(
      "sha256",
      Buffer.from(data),
      PUBLIC_KEY,
      Buffer.from(signature)
    );
    if (!res) return;

    const decoded: CompressedLicenseData = JSON.parse(btoa(data));

    // Valid structure
    if (!decoded || !decoded.o || !decoded.u) return;

    // Check valid issue date
    if (
      !decoded.i ||
      decoded.i < new Date("2021-09-01T00:00:00Z").getTime() / 1000 ||
      decoded.i > Date.now() / 1000
    ) {
      return;
    }

    // Check valid expiration date
    if (
      !decoded.e ||
      // Give a buffer of 90 days past the expiration date
      decoded.e < Date.now() / 1000 - 90 * 24 * 60 * 60
    ) {
      return;
    }

    const licenseData = {
      owner: decoded.o,
      expires_at: new Date(decoded.e * 1000),
      issued_at: new Date(decoded.i * 1000),
      user_seats: decoded.u,
    };
    licenseMap.set(license, licenseData);
    return licenseData;
  }

  return licenseMap.get(license);
}

export function generateSignedLicense(
  owner: string,
  seats: number,
  expires: Date
): string {
  if (!LICENSE_PRIVATE_KEY) return "";

  const obj: CompressedLicenseData = {
    o: owner,
    i: Math.floor(Date.now() / 1000),
    e: Math.floor(expires.getTime() / 1000),
    u: seats,
  };

  const json = JSON.stringify(obj);

  const signature = sign("sha256", Buffer.from(json), LICENSE_PRIVATE_KEY);

  return signature.toString("base64") + ";" + atob(json);
}
