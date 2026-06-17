import crypto from "crypto";
import mongoose from "mongoose";
import { CliAuthRequestStatus } from "shared/validators";

export interface CliAuthRequestInterface {
  requestId: string;
  clientName: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  suggestedOrgName?: string;
  status: CliAuthRequestStatus;
  userId?: string;
  organizationId?: string;
  apiKeyId?: string;
  exchangeCodeHash?: string;
  loopbackPort?: number;
  exchangeAttempts: number;
  createdAt: Date;
  expiresAt: Date;
  approvedAt?: Date;
  exchangedAt?: Date;
}

const cliAuthRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    unique: true,
  },
  clientName: String,
  codeChallenge: String,
  codeChallengeMethod: String,
  suggestedOrgName: String,
  status: String,
  userId: String,
  organizationId: String,
  apiKeyId: String,
  exchangeCodeHash: String,
  loopbackPort: Number,
  exchangeAttempts: { type: Number, default: 0 },
  createdAt: Date,
  // TTL: documents auto-expire 1 hour after expiresAt regardless of status.
  // 10-min logical TTL is enforced in handlers; this is the storage backstop.
  expiresAt: {
    type: Date,
    expires: 60 * 60,
  },
  approvedAt: Date,
  exchangedAt: Date,
});

export const CliAuthRequestModel = mongoose.model<CliAuthRequestInterface>(
  "CliAuthRequest",
  cliAuthRequestSchema,
);

const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_EXCHANGE_ATTEMPTS = 3;

function newRequestId(): string {
  return "cliauth_" + crypto.randomBytes(24).toString("base64url");
}

function newExchangeCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashExchangeCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function timingSafeStringEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function createCliAuthRequest(input: {
  clientName: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  suggestedOrgName?: string;
}): Promise<CliAuthRequestInterface> {
  const now = new Date();
  const doc: CliAuthRequestInterface = {
    requestId: newRequestId(),
    clientName: input.clientName,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    suggestedOrgName: input.suggestedOrgName,
    status: "pending",
    exchangeAttempts: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
  };
  await CliAuthRequestModel.create(doc);
  return doc;
}

export async function getCliAuthRequestById(
  requestId: string,
): Promise<CliAuthRequestInterface | null> {
  const doc = await CliAuthRequestModel.findOne({ requestId }).lean();
  if (!doc) return null;
  return doc;
}

export function isRequestExpired(req: CliAuthRequestInterface): boolean {
  return req.expiresAt.getTime() < Date.now();
}

export async function approveCliAuthRequest(input: {
  requestId: string;
  userId: string;
  organizationId: string;
  loopbackPort: number;
}): Promise<{ exchangeCode: string } | null> {
  const exchangeCode = newExchangeCode();
  const exchangeCodeHash = hashExchangeCode(exchangeCode);
  const now = new Date();

  // Atomically transition pending -> approved only if not expired
  const result = await CliAuthRequestModel.updateOne(
    {
      requestId: input.requestId,
      status: "pending",
      expiresAt: { $gt: now },
    },
    {
      $set: {
        status: "approved",
        userId: input.userId,
        organizationId: input.organizationId,
        loopbackPort: input.loopbackPort,
        exchangeCodeHash,
        approvedAt: now,
      },
    },
  );
  if (result.matchedCount === 0) return null;
  return { exchangeCode };
}

export type ExchangeResult =
  | { ok: true; doc: CliAuthRequestInterface }
  | {
      ok: false;
      reason:
        | "not_found"
        | "expired"
        | "wrong_state"
        | "bad_code"
        | "bad_verifier"
        | "too_many_attempts";
    };

export async function verifyAndConsumeExchange(input: {
  requestId: string;
  exchangeCode: string;
  codeVerifier: string;
}): Promise<ExchangeResult> {
  const doc = await CliAuthRequestModel.findOne({
    requestId: input.requestId,
  });
  if (!doc) return { ok: false, reason: "not_found" };

  if (doc.status !== "approved") {
    return { ok: false, reason: "wrong_state" };
  }
  if (doc.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (doc.exchangeAttempts >= MAX_EXCHANGE_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  // Verify PKCE verifier
  const verifierHash = crypto
    .createHash("sha256")
    .update(input.codeVerifier)
    .digest("base64url");
  if (!timingSafeStringEquals(verifierHash, doc.codeChallenge)) {
    await CliAuthRequestModel.updateOne(
      { requestId: input.requestId },
      { $inc: { exchangeAttempts: 1 } },
    );
    return { ok: false, reason: "bad_verifier" };
  }

  // Verify exchange code
  const submittedHash = hashExchangeCode(input.exchangeCode);
  if (
    !doc.exchangeCodeHash ||
    !timingSafeStringEquals(submittedHash, doc.exchangeCodeHash)
  ) {
    await CliAuthRequestModel.updateOne(
      { requestId: input.requestId },
      { $inc: { exchangeAttempts: 1 } },
    );
    return { ok: false, reason: "bad_code" };
  }

  // Atomic transition approved -> exchanged
  const result = await CliAuthRequestModel.updateOne(
    { requestId: input.requestId, status: "approved" },
    { $set: { status: "exchanged", exchangedAt: new Date() } },
  );
  if (result.matchedCount === 0) {
    return { ok: false, reason: "wrong_state" };
  }

  const fresh = await CliAuthRequestModel.findOne({
    requestId: input.requestId,
  }).lean();
  if (!fresh) return { ok: false, reason: "not_found" };
  return { ok: true, doc: fresh };
}

export async function recordApiKeyOnRequest(
  requestId: string,
  apiKeyId: string,
): Promise<void> {
  await CliAuthRequestModel.updateOne({ requestId }, { $set: { apiKeyId } });
}
