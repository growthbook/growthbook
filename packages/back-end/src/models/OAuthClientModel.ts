import crypto from "crypto";
import mongoose from "mongoose";
import { OAuthClientInterface } from "shared/validators";

/**
 * Public OAuth clients registered via DCR (RFC 7591).
 *
 * Clients are globally scoped (no `organization`) — they are not a fit for
 * BaseModel. Auth codes and refresh tokens live in BaseModel classes
 * (`OAuthAuthCodeModel`, `OAuthRefreshTokenModel`).
 *
 * Mongoose models stay file-private; only helpers are exported.
 */

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
});

const OAuthClientModel = mongoose.model<OAuthClientInterface>(
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
