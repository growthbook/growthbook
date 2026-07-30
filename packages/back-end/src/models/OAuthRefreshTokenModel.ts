import {
  OAuthRefreshTokenInterface,
  oauthRefreshTokenValidator,
} from "shared/validators";
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
  additionalIndexes: [
    { fields: { organization: 1, clientId: 1, userId: 1 } },
    // No custom name — mongoose previously created this as `expiresAt_1`.
    // Also reaps consumed tokens once they pass the reuse-detection window.
    { fields: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});

/**
 * Org-scoped OAuth refresh tokens.
 *
 * Revoke/refresh look up by hash before the org is known
 * ({@link dangerousFindByHash}); subsequent lifecycle ops use a ReqContext
 * instance so deletes are org-scoped and audited.
 *
 * Rotation marks tokens consumed ({@link consumeByTokenHash}) rather than
 * deleting them, so replay is detectable as reuse (RFC 9700 §4.14.2).
 */
export class OAuthRefreshTokenModel extends BaseClass {
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
    const doc = await getCollection<OAuthRefreshTokenInterface>(
      COLLECTION_NAME,
    ).findOne({ tokenHash });
    return doc;
  }

  /**
   * Atomically mark consumed; returns null if already consumed (reuse signal).
   * Org-scoped so rotation can't touch another org's token.
   */
  public async consumeByTokenHash(
    tokenHash: string,
  ): Promise<OAuthRefreshTokenInterface | null> {
    const now = new Date();
    const result = await this._dangerousGetCollection().findOneAndUpdate(
      {
        tokenHash,
        organization: this.context.org.id,
        // Matches missing or explicitly null consumedAt
        consumedAt: null,
      },
      { $set: { consumedAt: now, dateUpdated: now } },
      { returnDocument: "before" },
    );
    // mongodb@4 returns ModifyResult `{ value }`; newer drivers may return the doc.
    if (result && typeof result === "object" && "value" in result) {
      return (result.value as OAuthRefreshTokenInterface | null) ?? null;
    }
    return (result as OAuthRefreshTokenInterface | null) ?? null;
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
