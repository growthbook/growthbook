import crypto from "crypto";
import {
  OAuthAppInterface,
  OAuthAppProps,
  OrgOAuthAppInterface,
  orgOAuthAppValidator,
} from "shared/validators";
import { ORG_OAUTH_APP_CLIENT_ID_PREFIX } from "shared/util";
import { getCollection } from "back-end/src/util/mongo.util";
import { hashToken } from "back-end/src/util/oauth-token.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "orgoauthapps";

const CLIENT_SECRET_PREFIX = "gbcs_";

function newClientSecret(): string {
  return CLIENT_SECRET_PREFIX + crypto.randomBytes(32).toString("base64url");
}

const BaseClass = MakeModelClass({
  schema: orgOAuthAppValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: ORG_OAUTH_APP_CLIENT_ID_PREFIX,
  globallyUniquePrimaryKeys: true,
  auditLog: {
    entity: "oauthApp",
    createEvent: "oauthApp.create",
    updateEvent: "oauthApp.update",
    deleteEvent: "oauthApp.delete",
    // Everything but the secret hash.
    detailsAllowlist: [
      "id",
      "clientName",
      "redirectUris",
      "clientUri",
      "createdBy",
      "dateCreated",
      "dateUpdated",
    ],
  },
  readonlyFields: ["createdBy"],
});

/**
 * Confidential OAuth clients registered by an org's admins. The BaseModel
 * `id` doubles as the OAuth `client_id`. Public DCR clients are a different
 * collection, see `GlobalOAuthClientModel`.
 */
export class OrgOAuthAppModel extends BaseClass {
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

  /** Cross-org lookup for the public token endpoints, which only know the client_id. */
  public static async dangerousFindById(
    clientId: string,
  ): Promise<OrgOAuthAppInterface | null> {
    return getCollection<OrgOAuthAppInterface>(COLLECTION_NAME).findOne({
      id: clientId,
    });
  }

  /** Admin-facing shape: no secret hash, and `id` surfaces as `clientId`. */
  public static toPublic(doc: OrgOAuthAppInterface): OAuthAppInterface {
    return {
      clientId: doc.id,
      clientName: doc.clientName,
      redirectUris: doc.redirectUris,
      clientUri: doc.clientUri,
      createdBy: doc.createdBy,
      dateCreated: doc.dateCreated,
      dateUpdated: doc.dateUpdated,
    };
  }

  /** The plaintext secret is returned once. */
  public async createApp(
    props: OAuthAppProps,
  ): Promise<{ app: OAuthAppInterface; clientSecret: string }> {
    const clientSecret = newClientSecret();
    const doc = await this.create({
      clientName: props.clientName,
      redirectUris: props.redirectUris,
      clientUri: props.clientUri || "",
      clientSecretHash: hashToken(clientSecret),
      createdBy: this.context.userId,
    });
    return { app: OrgOAuthAppModel.toPublic(doc), clientSecret };
  }

  public async updateApp(
    existing: OrgOAuthAppInterface,
    props: OAuthAppProps,
  ): Promise<OAuthAppInterface> {
    const doc = await this.update(existing, {
      clientName: props.clientName,
      redirectUris: props.redirectUris,
      clientUri: props.clientUri || "",
    });
    return OrgOAuthAppModel.toPublic(doc);
  }

  /** Replaces the secret; the old one stops working immediately. */
  public async rotateSecret(existing: OrgOAuthAppInterface): Promise<string> {
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
