import { randomUUID } from "node:crypto";
import {
  slackTaskClaimSchema,
  SlackTaskClaimInterface,
} from "shared/validators";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "slacktaskclaims";
const THREAD_CLAIM_TTL_MS = 15 * 60 * 1000;
let uniqueIndexReady: Promise<string> | null = null;

const BaseClass = MakeModelClass({
  schema: slackTaskClaimSchema,
  collectionName: COLLECTION_NAME,
  globallyUniquePrimaryKeys: true,
});

export class SlackTaskClaimModel extends BaseClass {
  // Internal coordination is available to every org context; callers authorize the action.
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return false;
  }
  protected canDelete() {
    return false;
  }

  protected async customValidation(doc: SlackTaskClaimInterface) {
    // BaseModel's create validator replaces the id field with an unrestricted string.
    slackTaskClaimSchema.parse(doc);
  }

  protected async beforeCreate() {
    // BaseModel builds indexes in the background. Claims must fail closed until this exists.
    uniqueIndexReady ??= this._dangerousGetCollection()
      .createIndex({ id: 1 }, { unique: true })
      .catch((error: unknown) => {
        uniqueIndexReady = null;
        throw error;
      });
    await uniqueIndexReady;
  }

  /** Permanent claim: granted once, never released. */
  public async claim(key: string): Promise<boolean> {
    try {
      await this._createOne({ id: key });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  /**
   * Holds a Slack thread for one turn. Returns null while another worker holds
   * a live claim. A claim past its deadline is taken over, so a crashed or hung
   * worker never blocks its thread for longer than the TTL.
   */
  public async claimThread(
    key: string,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const now = Date.now();
    await this._dangerousGetCollection().deleteOne({
      id: key,
      expiresAt: { $lte: new Date(now) },
    });
    const claim = {
      token: randomUUID(),
      expiresAt: new Date(now + THREAD_CLAIM_TTL_MS),
    };
    try {
      await this._createOne({ id: key, ...claim });
      return claim;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  /** Only the holder releases; a stale worker's token no longer matches. */
  public async releaseThread(key: string, token: string): Promise<void> {
    await this._dangerousGetCollection().deleteOne({ id: key, token });
  }
}
