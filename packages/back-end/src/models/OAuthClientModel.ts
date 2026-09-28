import crypto from "crypto";
import mongoose from "mongoose";
import {
  OAuthAppInterface,
  OAuthAppProps,
  OAuthClientInterface,
} from "shared/validators";
import { ORG_OAUTH_APP_CLIENT_ID_PREFIX } from "shared/util";
import { OAUTH_REFRESH_TOKEN_TTL_SECONDS } from "back-end/src/util/secrets";
import { hashToken } from "back-end/src/util/oauth-token.util";

/**
 * Public OAuth clients registered via DCR (RFC 7591).
 *
 * Clients are globally scoped (no `organization`) — they are not a fit for
 * BaseModel. Auth codes and refresh tokens live in BaseModel classes
 * (`OAuthAuthCodeModel`, `OAuthRefreshTokenModel`).
 *
 * DCR is unauthenticated, so `expiresAt` + a TTL index bound growth
 * (see {@link touchOAuthClient}). Mongoose models stay file-private.
 */

// Unused DCR rows: long enough for a slow authorize+consent, short enough to
// limit spam.
const UNUSED_CLIENT_GRACE_SECONDS = 24 * 60 * 60; // 24 hours

// Idle window after first use (reset via touchOAuthClient). Longer than the
// default refresh-token lifetime so a cached client_id still works.
const ACTIVE_CLIENT_IDLE_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Client must outlive tokens that reference it; stretch past a high refresh TTL.
const ACTIVE_CLIENT_MARGIN_SECONDS = 2 * 24 * 60 * 60; // 2 days

function unusedClientExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + UNUSED_CLIENT_GRACE_SECONDS * 1000);
}

function activeClientExpiry(now: Date = new Date()): Date {
  const seconds = Math.max(
    ACTIVE_CLIENT_IDLE_SECONDS,
    OAUTH_REFRESH_TOKEN_TTL_SECONDS + ACTIVE_CLIENT_MARGIN_SECONDS,
  );
  return new Date(now.getTime() + seconds * 1000);
}

// Raw Mongoose (not BaseModel): clients are global, so there's no
// `organization` scope for BaseModel's multi-tenant helpers to key on.
const oauthClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  clientName: String,
  redirectUris: { type: [String], required: true },
  tokenEndpointAuthMethod: { type: String, default: "none" },
  grantTypes: [String],
  responseTypes: [String],
  scope: String,
  clientUri: String,
  organization: { type: String, index: true, sparse: true },
  clientSecretHash: String,
  createdBy: String,
  dateCreated: { type: Date, default: Date.now },
  dateUpdated: Date,
  expiresAt: Date,
});
oauthClientSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OAuthClientModel = mongoose.model<OAuthClientInterface>(
  "OAuthClient",
  oauthClientSchema,
);

export async function createOAuthClient(
  props: Omit<
    OAuthClientInterface,
    "clientId" | "dateCreated" | "expiresAt"
  > & {
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
    expiresAt: unusedClientExpiry(),
  };
  await OAuthClientModel.create(doc);
  return doc;
}

export async function getOAuthClientById(
  clientId: string,
): Promise<OAuthClientInterface | null> {
  return OAuthClientModel.findOne<OAuthClientInterface>({ clientId }).lean();
}

export async function getOAuthClientsByIds(
  clientIds: string[],
): Promise<OAuthClientInterface[]> {
  if (!clientIds.length) return [];
  return OAuthClientModel.find<OAuthClientInterface>({
    clientId: { $in: clientIds },
  }).lean();
}

/** Reset idle TTL on token issuance. Org apps have no TTL and are skipped. */
export async function touchOAuthClient(clientId: string): Promise<void> {
  await OAuthClientModel.updateOne(
    { clientId, organization: { $exists: false } },
    { $set: { expiresAt: activeClientExpiry() } },
  );
}

const CLIENT_SECRET_PREFIX = "gbcs_";

function newClientSecret(): string {
  return CLIENT_SECRET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

function toOAuthApp(doc: OAuthClientInterface): OAuthAppInterface {
  return {
    clientId: doc.clientId,
    clientName: doc.clientName || doc.clientId,
    redirectUris: doc.redirectUris,
    clientUri: doc.clientUri,
    createdBy: doc.createdBy,
    dateCreated: doc.dateCreated,
    dateUpdated: doc.dateUpdated,
  };
}

/** Confidential client owned by an org. The plaintext secret is returned once. */
export async function createOrgOAuthApp(
  organization: string,
  createdBy: string,
  props: OAuthAppProps,
): Promise<{ app: OAuthAppInterface; clientSecret: string }> {
  const clientSecret = newClientSecret();
  const doc: OAuthClientInterface = {
    clientId:
      ORG_OAUTH_APP_CLIENT_ID_PREFIX + crypto.randomBytes(16).toString("hex"),
    clientName: props.clientName,
    redirectUris: props.redirectUris,
    clientUri: props.clientUri || undefined,
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    organization,
    clientSecretHash: hashToken(clientSecret),
    createdBy,
    dateCreated: new Date(),
  };
  await OAuthClientModel.create(doc);
  return { app: toOAuthApp(doc), clientSecret };
}

export async function getOrgOAuthApps(
  organization: string,
): Promise<OAuthAppInterface[]> {
  const docs = await OAuthClientModel.find<OAuthClientInterface>({
    organization,
  })
    .sort({ dateCreated: -1 })
    .lean();
  return docs.map(toOAuthApp);
}

export async function getOrgOAuthApp(
  organization: string,
  clientId: string,
): Promise<OAuthAppInterface | null> {
  const doc = await OAuthClientModel.findOne<OAuthClientInterface>({
    organization,
    clientId,
  }).lean();
  return doc ? toOAuthApp(doc) : null;
}

export async function updateOrgOAuthApp(
  organization: string,
  clientId: string,
  props: OAuthAppProps,
): Promise<OAuthAppInterface | null> {
  const doc = await OAuthClientModel.findOneAndUpdate<OAuthClientInterface>(
    { organization, clientId },
    {
      $set: {
        clientName: props.clientName,
        redirectUris: props.redirectUris,
        dateUpdated: new Date(),
        ...(props.clientUri ? { clientUri: props.clientUri } : {}),
      },
      ...(props.clientUri ? {} : { $unset: { clientUri: 1 } }),
    },
    { new: true },
  ).lean();
  return doc ? toOAuthApp(doc) : null;
}

/** Replaces the secret; the old one stops working immediately. */
export async function rotateOrgOAuthAppSecret(
  organization: string,
  clientId: string,
): Promise<string | null> {
  const clientSecret = newClientSecret();
  const res = await OAuthClientModel.updateOne(
    { organization, clientId },
    {
      $set: {
        clientSecretHash: hashToken(clientSecret),
        dateUpdated: new Date(),
      },
    },
  );
  return res.matchedCount ? clientSecret : null;
}

export async function deleteOrgOAuthApp(
  organization: string,
  clientId: string,
): Promise<void> {
  await OAuthClientModel.deleteOne({ organization, clientId });
}
