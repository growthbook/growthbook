import { randomUUID } from "node:crypto";
import {
  slackTaskClaimSchema,
  SlackTaskClaimInterface,
} from "shared/validators";
import {
  ensureIndexOnce,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "slacktaskclaims";
const THREAD_CLAIM_TTL_MS = 15 * 60 * 1000;

const BaseClass = MakeModelClass({
  schema: slackTaskClaimSchema,
  collectionName: COLLECTION_NAME,
  globallyUniquePrimaryKeys: true,
});

/**
 * Coordination claims for the Slack assistant. `claimOnce` grants a permanent
 * claim exactly once; `acquireThreadLease` holds a thread for one turn and is
 * released or taken over. See the validator for which id prefixes use which.
 */
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
    // Claims supply their own hash-keyed ids, and BaseModel's create validator
    // loosens `id` to any optional string, so the id pattern is checked here.
    slackTaskClaimSchema.parse(doc);
  }

  protected async beforeCreate() {
    // A claim is only a claim if the unique index exists when it is written.
    await ensureIndexOnce(
      this._dangerousGetCollection(),
      { id: 1 },
      { unique: true },
    );
  }

  /** Permanent claim: granted once, never released. */
  public async claimOnce(key: string): Promise<boolean> {
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
  public async acquireThreadLease(
    key: string,
  ): Promise<{ token: string; expiresAt: Date } | null> {
    const now = Date.now();
    await this._dangerousGetCollection().deleteOne({
      id: key,
      expiresAt: { $lte: new Date(now) },
    });
    const lease = {
      token: randomUUID(),
      expiresAt: new Date(now + THREAD_CLAIM_TTL_MS),
    };
    try {
      await this._createOne({ id: key, ...lease });
      return lease;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  /** Only the holder releases; a stale worker's token no longer matches. */
  public async releaseThreadLease(key: string, token: string): Promise<void> {
    await this._dangerousGetCollection().deleteOne({ id: key, token });
  }
}
