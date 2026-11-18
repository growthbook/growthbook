import crypto from "crypto";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { AES, enc } from "crypto-js";
import { UserInterface } from "shared/types/user";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";
import {
  claimMfaStep,
  consumeMfaRecoveryCode,
} from "back-end/src/models/UserModel";
import { AuthRefreshModel } from "back-end/src/models/AuthRefreshModel";
import { RefreshTokenCookie, setIdTokenCookie } from "back-end/src/util/cookie";
import { getAuthConnection } from "back-end/src/services/auth";
import { base32Encode, verifyTotp } from "back-end/src/util/totp";
import { AuthRequest } from "back-end/src/types/AuthRequest";

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

// Throws, and flags the response for mfaCodeRateLimit, when the code is wrong
export async function assertMfaCode(
  user: Pick<UserInterface, "id" | "mfaSecret" | "mfaLastUsedStep">,
  code: unknown,
  res: Response,
) {
  if (!(await verifyUserMfaCode(user, code))) {
    res.locals.mfaCodeRejected = true;
    throw new Error("Invalid authentication code");
  }
}

// Counts only rejected codes, so a wrong password can't lock the real user out
export const mfaCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req: Request, res: Response) =>
    !res.locals.mfaCodeRejected,
  keyGenerator: (req: Request) =>
    (req as AuthRequest).userId ||
    String(req.body?.email || "").toLowerCase() ||
    req.ip ||
    "",
  message: {
    status: 429,
    message: "Too many authentication code attempts. Try again later.",
  },
});

// Swaps the current local-auth session for one whose MFA state matches the account's
export async function reissueLocalSession(
  req: Request,
  res: Response,
  user: UserInterface,
  mfa: boolean,
) {
  const oldToken = RefreshTokenCookie.getValue(req);
  if (oldToken) {
    await AuthRefreshModel.deleteOne({ token: { $eq: String(oldToken) } });
  }
  const { idToken, refreshToken } = await getAuthConnection().processCallback(
    req,
    res,
    user,
    mfa,
  );
  setIdTokenCookie(idToken, req, res);
  RefreshTokenCookie.setValue(refreshToken, req, res);
}
