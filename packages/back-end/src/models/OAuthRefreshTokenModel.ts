import {
  OAuthRefreshTokenInterface,
  oauthRefreshTokenValidator,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "oauthrefreshtokens";

const BaseClass = MakeModelClass({
  schema: oauthRefreshTokenValidator,
  collectionName: COLLECTION_NAME,
  pKey: ["tokenHash"] as const,
  globallyUniquePrimaryKeys: true,
  idPrefix: "ort_",
  auditLog: {
    entity: "oauthRefreshToken",
    createEvent: "oauthRefreshToken.create",
    updateEvent: "oauthRefreshToken.update",
    deleteEvent: "oauthRefreshToken.delete",
  },
  additionalIndexes: [{ fields: { organization: 1, clientId: 1, userId: 1 } }],
});

let ttlIndexEnsured = false;
function ensureExpiresAtTtlIndex() {
  if (ttlIndexEnsured) return;
  ttlIndexEnsured = true;
  // Kept local so we don't need to extend BaseModel's additionalIndexes for TTL.
  // No custom name — mongoose previously created this as `expiresAt_1`, and
  // createIndex is idempotent when the name/options match.
  void getCollection(COLLECTION_NAME)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((err) => {
      logger.error(
        err,
        `Error creating expiresAt TTL index for ${COLLECTION_NAME}`,
      );
    });
}

/**
 * Org-scoped OAuth refresh tokens.
 *
 * Revoke/refresh look up by hash before the org is known
 * ({@link dangerousFindByHash}); subsequent lifecycle ops use a ReqContext
 * instance so deletes are org-scoped and audited.
 */
export class OAuthRefreshTokenModel extends BaseClass {
  constructor(...args: ConstructorParameters<typeof BaseClass>) {
    super(...args);
    ensureExpiresAtTtlIndex();
  }

  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
  }

  /** Cross-org hash lookup for the public token/revoke endpoints. */
  public static async dangerousFindByHash(
    tokenHash: string,
  ): Promise<OAuthRefreshTokenInterface | null> {
    ensureExpiresAtTtlIndex();
    const doc = await getCollection<OAuthRefreshTokenInterface>(
      COLLECTION_NAME,
    ).findOne({ tokenHash });
    return doc;
  }

  public async getByTokenHash(
    tokenHash: string,
  ): Promise<OAuthRefreshTokenInterface | null> {
    return this._findOne({ tokenHash });
  }

  /** Tear down every refresh token for one client/user grant in this org. */
  public async deleteForGrant(clientId: string, userId: string): Promise<void> {
    const tokens = await this._find(
      { clientId, userId },
      { bypassReadPermissionChecks: true },
    );
    for (const token of tokens) {
      await this.delete(token);
    }
  }
}
