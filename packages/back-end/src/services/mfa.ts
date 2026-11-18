import crypto from "crypto";
import { Request, Response } from "express";
import { AES, enc } from "crypto-js";
import { UserInterface } from "shared/types/user";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";
import {
  claimMfaStep,
  consumeMfaRecoveryCode,
} from "back-end/src/models/UserModel";
import { RefreshTokenCookie, setIdTokenCookie } from "back-end/src/util/cookie";
import { getAuthConnection } from "back-end/src/services/auth";
import { base32Encode, verifyTotp } from "back-end/src/util/totp";
import { TooManyRequestsError } from "back-end/src/util/errors";

export function encryptMfaSecret(secret: Buffer): string {
  return AES.encrypt(secret.toString("hex"), ENCRYPTION_KEY).toString();
}

function decryptMfaSecret(ciphertext: string): Buffer {
  try {
    return Buffer.from(
      AES.decrypt(ciphertext, ENCRYPTION_KEY).toString(enc.Utf8),
      "hex",
    );
  } catch {
    return Buffer.alloc(0);
  }
}

function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

// 80 random bits each, so a plain SHA-256 is enough to store them
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () =>
    base32Encode(crypto.randomBytes(10))
      .toLowerCase()
      .match(/.{4}/g)!
      .join("-"),
  );
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// Accepts an authenticator code or an unused recovery code
async function verifyUserMfaCode(
  user: Pick<UserInterface, "id" | "mfaSecret" | "mfaLastUsedStep">,
  code: unknown,
): Promise<boolean> {
  if (!user.mfaSecret || typeof code !== "string") return false;
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return consumeMfaRecoveryCode(user.id, hashRecoveryCode(trimmed));
  }
  const key = decryptMfaSecret(user.mfaSecret);
  if (!key.length) return false;
  const step = verifyTotp(key, trimmed, user.mfaLastUsedStep);
  if (step === null) return false;
  return claimMfaStep(user.id, user.mfaLastUsedStep, step);
}

const MFA_WINDOW_MS = 15 * 60 * 1000;
const MFA_MAX_FAILURES = 10;
// Per replica, keyed by user, so only someone past the password check can add to it
const mfaFailures = new Map<string, { count: number; resetAt: number }>();

export async function assertMfaCode(
  user: Pick<UserInterface, "id" | "mfaSecret" | "mfaLastUsedStep">,
  code: unknown,
) {
  const now = Date.now();
  let entry = mfaFailures.get(user.id);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + MFA_WINDOW_MS };
    mfaFailures.set(user.id, entry);
  }
  if (entry.count >= MFA_MAX_FAILURES) {
    throw new TooManyRequestsError(
      "Too many authentication code attempts. Try again later.",
    );
  }
  // Counted before the await so concurrent guesses can't overshoot the limit
  entry.count++;
  let valid: boolean;
  try {
    valid = await verifyUserMfaCode(user, code);
  } catch (e) {
    entry.count--;
    throw e;
  }
  if (!valid) throw new Error("Invalid authentication code");
  entry.count--;
  if (entry.count === 0) mfaFailures.delete(user.id);
}

// Gives this browser a session whose MFA state matches the account's
export async function reissueLocalSession(
  req: Request,
  res: Response,
  user: UserInterface,
  mfa: boolean,
) {
  const { idToken, refreshToken } = await getAuthConnection().processCallback(
    req,
    res,
    user,
    mfa,
  );
  setIdTokenCookie(idToken, req, res);
  RefreshTokenCookie.setValue(refreshToken, req, res);
}
