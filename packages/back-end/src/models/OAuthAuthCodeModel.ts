import {
  OAuthAuthCodeInterface,
  oauthAuthCodeValidator,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "oauthauthcodes";

const BaseClass = MakeModelClass({
  schema: oauthAuthCodeValidator,
  collectionName: COLLECTION_NAME,
  pKey: ["codeHash"] as const,
  globallyUniquePrimaryKeys: true,
  idPrefix: "oac_",
  // No audit log: one row per login for a ten-minute credential is noise, and it would carry the code hash.
  defaultValues: {
    used: false,
    codeChallengeMethod: "S256" as const,
  },
  additionalIndexes: [
    { fields: { organization: 1, clientId: 1, userId: 1 } },
    // No custom name — mongoose previously created this as `expiresAt_1`.
    { fields: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ],
});

/**
 * Org-scoped authorization codes.
 *
 * Token exchange looks up by hash before the org is known, so that bootstrap
 * uses {@link dangerousConsumeByHash}. Creation goes through a ReqContext
 * instance for multi-tenant scoping; consumed codes are left for the TTL index.
 */
export class OAuthAuthCodeModel extends BaseClass {
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

  /**
   * Atomically mark a code as used and return the pre-update doc.
   * Cross-org by necessity: the token endpoint only has the raw code.
   */
  public static async dangerousConsumeByHash(
    codeHash: string,
  ): Promise<OAuthAuthCodeInterface | null> {
    const now = new Date();
    const result = await getCollection<OAuthAuthCodeInterface>(
      COLLECTION_NAME,
    ).findOneAndUpdate(
      { codeHash, used: false, expiresAt: { $gt: now } },
      { $set: { used: true, dateUpdated: now } },
      { returnDocument: "before" },
    );
    // mongodb@4 returns ModifyResult `{ value }`; newer drivers may return the doc.
    if (result && typeof result === "object" && "value" in result) {
      return (result.value as OAuthAuthCodeInterface | null) ?? null;
    }
    return (result as OAuthAuthCodeInterface | null) ?? null;
  }

  /** Grant teardown: burn this member's outstanding codes for the client. */
  public async consumeAllForGrant(
    clientId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, clientId, userId, used: false },
      { $set: { used: true, dateUpdated: now } },
    );
  }
}
