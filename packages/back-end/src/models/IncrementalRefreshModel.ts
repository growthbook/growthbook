import uniqid from "uniqid";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  IncrementalRefreshInterface,
  incrementalRefreshValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "incrementalrefresh";

const BaseClass = MakeModelClass({
  schema: incrementalRefreshValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "ir_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { organization: 1, experimentId: 1 },
      unique: true,
    },
  ],
});

export class IncrementalRefreshModel extends BaseClass {
  public async getByExperimentId(experimentId: string) {
    return this._findOne({ experimentId });
  }

  public async upsertByExperimentId(
    experimentId: string,
    data:
      | CreateProps<IncrementalRefreshInterface>
      | UpdateProps<IncrementalRefreshInterface>,
  ) {
    const existing = await this._findOne({ experimentId });
    if (existing) {
      return this.update(existing, data);
    }
    return this.create({
      experimentId,
      unitsTableFullName: null,
      unitsMaxTimestamp: null,
      unitsDimensions: [],
      metricSources: [],
      metricCovariateSources: [],
      experimentSettingsHash: null,
      currentExecutionSnapshotId: null,
      ...data,
    });
  }

  /**
   * Atomically clears the lock only if the given snapshotId still owns it.
   * Prevents a late-running cleanup from accidentally clearing another
   * process's lock.
   */
  public async clearCurrentExecutionSnapshotId(
    experimentId: string,
    snapshotId: string,
  ) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: snapshotId,
      },
      {
        $set: { currentExecutionSnapshotId: null, dateUpdated: new Date() },
      },
    );
  }

  public async getActiveExecutionSnapshotId(
    experimentId: string,
  ): Promise<string | null> {
    const doc = await this._findOne({ experimentId });
    return doc?.currentExecutionSnapshotId ?? null;
  }

  /**
   * Atomically acquires the incremental refresh lock via CAS.
   * Uses upsert so it works even if no document exists yet (first-ever refresh).
   * Returns true if the lock was acquired, false if another process holds it.
   */
  public async acquireLock(
    experimentId: string,
    snapshotId: string,
  ): Promise<boolean> {
    try {
      const result = await this._dangerousGetCollection().updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          currentExecutionSnapshotId: null,
        },
        {
          $set: {
            currentExecutionSnapshotId: snapshotId,
            dateUpdated: new Date(),
          },
          $setOnInsert: {
            id: uniqid("ir_"),
            organization: this.context.org.id,
            experimentId,
            dateCreated: new Date(),
            unitsTableFullName: null,
            unitsMaxTimestamp: null,
            unitsDimensions: [],
            metricSources: [],
            metricCovariateSources: [],
            experimentSettingsHash: null,
          },
        },
        { upsert: true },
      );
      // upsertedCount > 0 means we created a new doc with the lock
      // modifiedCount > 0 means we updated an existing unlocked doc
      return (result.upsertedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0;
    } catch (error) {
      // Duplicate key error from concurrent upserts — another process won the race
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Atomically upserts only if the current execution still owns the lock.
   * Returns true if it worked, false otherwise.
   */
  public async upsertByExperimentIdIfCurrentExecution(
    experimentId: string,
    executionId: string,
    data: UpdateProps<IncrementalRefreshInterface>,
  ): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: executionId,
      },
      { $set: { ...data, dateUpdated: new Date() } },
    );
    return result.matchedCount > 0;
  }
  protected canRead(_doc: IncrementalRefreshInterface) {
    return true;
  }
  protected canCreate(_doc: IncrementalRefreshInterface) {
    return true;
  }
  protected canUpdate(
    _existing: IncrementalRefreshInterface,
    _updates: UpdateProps<IncrementalRefreshInterface>,
    _newDoc: IncrementalRefreshInterface,
  ) {
    return true;
  }
  protected canDelete(_existing: IncrementalRefreshInterface) {
    return true;
  }
}
