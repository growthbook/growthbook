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
const THREAD_LEASE_TTL_MS = 2 * 60 * 1000;
/** Renewing at a quarter of the TTL lets a lease survive a few missed renewals. */
export const THREAD_LEASE_RENEW_MS = THREAD_LEASE_TTL_MS / 4;

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
   * Holds a Slack thread for one turn and returns the holder's token, or null
   * while another worker holds a live lease. The holder keeps renewing it, so
   * an expired lease belongs to a worker that died or gave up and is taken over.
   */
  public async acquireThreadLease(key: string): Promise<string | null> {
    const now = Date.now();
    await this._dangerousGetCollection().deleteOne({
      id: key,
      expiresAt: { $lte: new Date(now) },
    });
    const token = randomUUID();
    try {
      await this._createOne({
        id: key,
        token,
        expiresAt: new Date(now + THREAD_LEASE_TTL_MS),
      });
      return token;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  /** Extends the holder's lease. False means it expired and was taken over. */
  public async renewThreadLease(key: string, token: string): Promise<boolean> {
    const { matchedCount } = await this._dangerousGetCollection().updateOne(
      { id: key, token },
      { $set: { expiresAt: new Date(Date.now() + THREAD_LEASE_TTL_MS) } },
    );
    return matchedCount === 1;
  }

  /** Only the holder releases; a stale worker's token no longer matches. */
  public async releaseThreadLease(key: string, token: string): Promise<void> {
    await this._dangerousGetCollection().deleteOne({ id: key, token });
  }
}
