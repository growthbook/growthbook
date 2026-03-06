import { UpdateProps } from "shared/types/base-model";
import {
  ExperimentRefreshLockInterface,
  experimentRefreshLockValidator,
} from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "experimentrefreshlocks";

const BaseClass = MakeModelClass({
  schema: experimentRefreshLockValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "erl_",
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: { organization: 1, experimentId: 1 },
      unique: true,
    },
  ],
});

export class ExperimentRefreshLockModel extends BaseClass {
  public constructor(context: ConstructorParameters<typeof BaseClass>[0]) {
    super(context);
    this.ensureTTLIndex();
  }

  private static ttlIndexCreated = false;
  private ensureTTLIndex() {
    if (ExperimentRefreshLockModel.ttlIndexCreated) return;
    ExperimentRefreshLockModel.ttlIndexCreated = true;

    this._dangerousGetCollection()
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => {
        logger.error(
          err,
          `Error creating TTL index on expiresAt for ${COLLECTION_NAME}`,
        );
      });
  }

  /**
   * Atomically acquire a lock for an experiment's incremental refresh.
   * Uses findOneAndUpdate with upsert to ensure only one lock can be held at a time.
   *
   * If no lock exists or the existing lock is expired, creates/replaces the lock atomically.
   * If an active (non-expired) lock exists, returns it without modification.
   */
  public async acquireLock(
    experimentId: string,
    snapshotId: string,
    triggeredBy: "manual" | "schedule",
    ttlMinutes: number = 30,
  ): Promise<{
    acquired: boolean;
    existingLock?: ExperimentRefreshLockInterface;
  }> {
    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const collection = this._dangerousGetCollection();
    const organization = this.context.org.id;

    const result = await collection.findOneAndUpdate(
      {
        organization,
        experimentId,
        // Only match if lock doesn't exist (upsert) or is expired
        expiresAt: { $lt: now },
      },
      {
        $set: {
          snapshotId,
          triggeredBy,
          lockedAt: now,
          expiresAt,
          dateUpdated: now,
        },
        $setOnInsert: {
          id: this._generateId(),
          organization,
          experimentId,
          dateCreated: now,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      },
    );

    const doc = result as unknown as ExperimentRefreshLockInterface | null;
    if (doc && doc.snapshotId === snapshotId) {
      return { acquired: true };
    }

    // If we got here, the upsert did not match because an active lock exists.
    // Fetch the active lock to return it.
    const activeLock = await this.getActiveLock(experimentId);
    if (activeLock) {
      return { acquired: false, existingLock: activeLock };
    }

    // Edge case: lock expired between our check and fetch. Try again.
    return this.acquireLock(experimentId, snapshotId, triggeredBy, ttlMinutes);
  }

  /**
   * Release the lock for an experiment by deleting the lock document.
   */
  public async releaseLock(experimentId: string): Promise<void> {
    const collection = this._dangerousGetCollection();
    await collection.deleteOne({
      organization: this.context.org.id,
      experimentId,
    });
  }

  /**
   * Get the active (non-expired) lock for an experiment, if one exists.
   */
  public async getActiveLock(
    experimentId: string,
  ): Promise<ExperimentRefreshLockInterface | null> {
    return this._findOne({
      experimentId,
      expiresAt: { $gt: new Date() },
    });
  }

  protected canRead(_doc: ExperimentRefreshLockInterface) {
    return true;
  }
  protected canCreate(_doc: ExperimentRefreshLockInterface) {
    return true;
  }
  protected canUpdate(
    _existing: ExperimentRefreshLockInterface,
    _updates: UpdateProps<ExperimentRefreshLockInterface>,
    _newDoc: ExperimentRefreshLockInterface,
  ) {
    return true;
  }
  protected canDelete(_existing: ExperimentRefreshLockInterface) {
    return true;
  }
}
