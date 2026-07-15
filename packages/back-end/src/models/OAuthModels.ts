import crypto from "crypto";
import mongoose from "mongoose";
import {
  OAuthAuthCodeInterface,
  OAuthClientInterface,
  OAuthRefreshTokenInterface,
} from "shared/validators";

// --- OAuth clients (DCR) ----------------------------------------------------

const oauthClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  clientName: String,
  redirectUris: { type: [String], required: true },
  tokenEndpointAuthMethod: { type: String, default: "none" },
  grantTypes: [String],
  responseTypes: [String],
  scope: String,
  clientUri: String,
  dateCreated: { type: Date, default: Date.now },
});

export const OAuthClientModel = mongoose.model<OAuthClientInterface>(
  "OAuthClient",
  oauthClientSchema,
);

export async function createOAuthClient(
  props: Omit<OAuthClientInterface, "clientId" | "dateCreated"> & {
    clientId?: string;
  },
): Promise<OAuthClientInterface> {
  const clientId =
    props.clientId || `gbc_${crypto.randomBytes(16).toString("hex")}`;
  const doc: OAuthClientInterface = {
    clientId,
    clientName: props.clientName,
    redirectUris: props.redirectUris,
    tokenEndpointAuthMethod: "none",
    grantTypes: props.grantTypes,
    responseTypes: props.responseTypes,
    scope: props.scope,
    clientUri: props.clientUri,
    dateCreated: new Date(),
  };
  await OAuthClientModel.create(doc);
  return doc;
}

export async function getOAuthClientById(
  clientId: string,
): Promise<OAuthClientInterface | null> {
  const doc = await OAuthClientModel.findOne({ clientId }).lean();
  return doc as OAuthClientInterface | null;
}

// --- Authorization codes ----------------------------------------------------

const oauthAuthCodeSchema = new mongoose.Schema({
  codeHash: { type: String, unique: true, required: true },
  clientId: { type: String, required: true },
  userId: { type: String, required: true },
  organization: { type: String, required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  codeChallengeMethod: { type: String, default: "S256" },
  scope: String,
  resource: String,
  used: { type: Boolean, default: false },
  expiresAt: {
    type: Date,
    required: true,
    // Mongo TTL: delete shortly after expiry (auth codes are ~10 min)
    expires: 0,
  },
  dateCreated: { type: Date, default: Date.now },
});

export const OAuthAuthCodeModel = mongoose.model<OAuthAuthCodeInterface>(
  "OAuthAuthCode",
  oauthAuthCodeSchema,
);

export async function insertAuthCode(
  doc: OAuthAuthCodeInterface,
): Promise<void> {
  await OAuthAuthCodeModel.create(doc);
}

/**
 * Atomically mark a code as used and return it. Returns null if missing,
 * already used, or expired.
 */
export async function consumeAuthCode(
  codeHash: string,
): Promise<OAuthAuthCodeInterface | null> {
  const now = new Date();
  const doc = await OAuthAuthCodeModel.findOneAndUpdate(
    { codeHash, used: false, expiresAt: { $gt: now } },
    { $set: { used: true } },
    { new: false },
  ).lean();
  return doc as OAuthAuthCodeInterface | null;
}

// --- Refresh tokens ---------------------------------------------------------

const oauthRefreshTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, unique: true, required: true },
  clientId: { type: String, required: true },
  userId: { type: String, required: true },
  organization: { type: String, required: true },
  scope: String,
  resource: String,
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
  dateCreated: { type: Date, default: Date.now },
});

export const OAuthRefreshTokenModel =
  mongoose.model<OAuthRefreshTokenInterface>(
    "OAuthRefreshToken",
    oauthRefreshTokenSchema,
  );

export async function insertRefreshToken(
  doc: OAuthRefreshTokenInterface,
): Promise<void> {
  await OAuthRefreshTokenModel.create(doc);
}

export async function findRefreshToken(
  tokenHash: string,
): Promise<OAuthRefreshTokenInterface | null> {
  const doc = await OAuthRefreshTokenModel.findOne({ tokenHash }).lean();
  return doc as OAuthRefreshTokenInterface | null;
}

export async function deleteRefreshToken(tokenHash: string): Promise<void> {
  await OAuthRefreshTokenModel.deleteOne({ tokenHash });
}

export async function deleteRefreshTokensForClientUser(
  clientId: string,
  userId: string,
): Promise<void> {
  await OAuthRefreshTokenModel.deleteMany({ clientId, userId });
}
