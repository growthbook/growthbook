import crypto from "crypto";
import isEqual from "lodash/isEqual";
import {
  OAuthAppInterface,
  OAuthAppProps,
  OrgOAuthClientInterface,
  orgOAuthClientValidator,
} from "shared/validators";
import { ORG_OAUTH_APP_CLIENT_ID_PREFIX } from "shared/util";
import { getCollection } from "back-end/src/util/mongo.util";
import { hashToken } from "back-end/src/util/oauth-token.util";
import { assertValidPermissionLimit } from "back-end/src/services/oauth/permissionLimit";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "orgoauthclients";

const CLIENT_SECRET_PREFIX = "gbcs_";

function newClientSecret(): string {
  return CLIENT_SECRET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

const BaseClass = MakeModelClass({
  schema: orgOAuthClientValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: ORG_OAUTH_APP_CLIENT_ID_PREFIX,
  globallyUniquePrimaryKeys: true,
  auditLog: {
    entity: "oauthApp",
    createEvent: "oauthApp.create",
    updateEvent: "oauthApp.update",
    deleteEvent: "oauthApp.delete",
    nameField: "clientName",
    // Everything but the secret hash.
    detailsAllowlist: [
      "id",
      "clientName",
      "redirectUris",
      "clientUri",
      "allowDelegation",
      "permissionLimit",
      "createdBy",
      "dateCreated",
      "dateUpdated",
    ],
  },
  readonlyFields: ["createdBy"],
});

/**
 * Confidential OAuth clients registered by an org's admins, surfaced in the
 * product as "OAuth apps". The BaseModel `id` doubles as the OAuth `client_id`.
 * Public DCR clients are a different collection, see `GlobalOAuthClientModel`.
 */
export class OrgOAuthClientModel extends BaseClass {
  protected canRead(): boolean {
    return this.context.permissions.canManageOAuthApps();
  }
  protected canCreate(): boolean {
    return this.context.permissions.canManageOAuthApps();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canManageOAuthApps();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canManageOAuthApps();
  }
  // Downgraded orgs keep using their apps and can delete them, but can't create or change them.
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("oauth-apps");
  }

  protected async customValidation(
    doc: OrgOAuthClientInterface,
    previousDoc?: OrgOAuthClientInterface,
  ) {
    const limit = doc.permissionLimit ?? null;
    const previous = previousDoc?.permissionLimit ?? null;
    // Only a changed limit is checked, so a stale one never blocks turning delegation off or rotating the secret.
    if (previousDoc && isEqual(limit, previous)) return;
    await assertValidPermissionLimit(this.context, limit, previous);
  }

  /** Cross-org lookup for the public token endpoints, which only know the client_id. */
  public static async dangerousFindById(
    clientId: string,
  ): Promise<OrgOAuthClientInterface | null> {
    return getCollection<OrgOAuthClientInterface>(COLLECTION_NAME).findOne({
      id: clientId,
    });
  }

  /** Admin-facing shape: no secret hash, and `id` surfaces as `clientId`. */
  public static toPublic(doc: OrgOAuthClientInterface): OAuthAppInterface {
    return {
      clientId: doc.id,
      clientName: doc.clientName,
      redirectUris: doc.redirectUris,
      clientUri: doc.clientUri,
      allowDelegation: doc.allowDelegation,
      permissionLimit: doc.permissionLimit ?? null,
      createdBy: doc.createdBy,
      dateCreated: doc.dateCreated,
      dateUpdated: doc.dateUpdated,
    };
  }

  /** The plaintext secret is returned once. */
  public async createClient(
    props: OAuthAppProps,
  ): Promise<{ client: OAuthAppInterface; clientSecret: string }> {
    const clientSecret = newClientSecret();
    const doc = await this.create({
      clientName: props.clientName,
      redirectUris: props.redirectUris,
      clientUri: props.clientUri || "",
      allowDelegation: props.allowDelegation ?? false,
      permissionLimit: props.permissionLimit ?? null,
      clientSecretHash: hashToken(clientSecret),
      createdBy: this.context.userId,
    });
    return { client: OrgOAuthClientModel.toPublic(doc), clientSecret };
  }

  public async updateClient(
    existing: OrgOAuthClientInterface,
    props: OAuthAppProps,
  ): Promise<OAuthAppInterface> {
    const doc = await this.update(existing, {
      clientName: props.clientName,
      redirectUris: props.redirectUris,
      clientUri: props.clientUri || "",
      allowDelegation: props.allowDelegation ?? existing.allowDelegation,
      permissionLimit:
        props.permissionLimit === undefined
          ? (existing.permissionLimit ?? null)
          : props.permissionLimit,
    });
    return OrgOAuthClientModel.toPublic(doc);
  }

  /** Replaces the secret; the old one stops working immediately. */
  public async rotateSecret(
    existing: OrgOAuthClientInterface,
  ): Promise<string> {
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }
    const clientSecret = newClientSecret();
    await this._updateOne(
      existing,
      { clientSecretHash: hashToken(clientSecret) },
      { auditEvent: "oauthApp.rotateSecret" },
    );
    return clientSecret;
  }
}
