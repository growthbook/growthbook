import crypto from "crypto";
import mongoose from "mongoose";
import { OAuthClientInterface } from "shared/validators";
import { OAUTH_REFRESH_TOKEN_TTL_SECONDS } from "back-end/src/util/secrets";

/**
 * Public OAuth clients registered via DCR (RFC 7591).
 *
 * Clients are globally scoped (no `organization`) — they are not a fit for
 * BaseModel. Org-registered confidential clients live in `OrgOAuthClientModel`;
 * auth codes and refresh tokens in `OAuthAuthCodeModel` / `OAuthRefreshTokenModel`.
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
  dateCreated: { type: Date, default: Date.now },
  expiresAt: Date,
});
oauthClientSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const GlobalOAuthClientModel = mongoose.model<OAuthClientInterface>(
  "OAuthClient",
  oauthClientSchema,
);

export async function createOAuthClient(
  props: Omit<OAuthClientInterface, "clientId" | "dateCreated" | "expiresAt">,
): Promise<OAuthClientInterface> {
  const doc: OAuthClientInterface = {
    clientId: `gbc_${crypto.randomBytes(16).toString("hex")}`,
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
  await GlobalOAuthClientModel.create(doc);
  return doc;
}

export async function getOAuthClientById(
  clientId: string,
): Promise<OAuthClientInterface | null> {
  return GlobalOAuthClientModel.findOne<OAuthClientInterface>({
    clientId,
  }).lean();
}

export async function getOAuthClientsByIds(
  clientIds: string[],
): Promise<OAuthClientInterface[]> {
  if (!clientIds.length) return [];
  return GlobalOAuthClientModel.find<OAuthClientInterface>({
    clientId: { $in: clientIds },
  }).lean();
}

/** Reset idle TTL on token issuance. */
export async function touchOAuthClient(clientId: string): Promise<void> {
  await GlobalOAuthClientModel.updateOne(
    { clientId },
    { $set: { expiresAt: activeClientExpiry() } },
  );
}
