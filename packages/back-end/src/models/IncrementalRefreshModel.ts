import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import {
  IncrementalRefreshInterface,
  incrementalRefreshValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "incrementalrefresh";

// A lock is considered stale once its heartbeat is older than this. The
// runner refreshes the heartbeat every ~30s while queries are executing, so
// this only needs to cover slow polls / brief stalls — not the full runtime
// of a refresh.
export const INCREMENTAL_LOCK_STALE_MS = 10 * 60 * 1000;

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
    data: UpdateProps<IncrementalRefreshInterface>,
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

  public async acquireLock(
    experimentId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const staleThreshold = new Date(Date.now() - INCREMENTAL_LOCK_STALE_MS);
    try {
      const result = await this._dangerousGetCollection().updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          $or: [
            // Unlocked
            { currentExecutionSnapshotId: null },
            // Heartbeat stale → holder crashed or stalled (non-null only;
            // null/missing heartbeats use the dateUpdated fallback below)
            { lockHeartbeatAt: { $lt: staleThreshold, $ne: null } },
            // Legacy docs without a heartbeat: fall back to dateUpdated
            { lockHeartbeatAt: null, dateUpdated: { $lt: staleThreshold } },
          ],
        },
        {
          $set: {
            currentExecutionSnapshotId: snapshotId,
            lockHeartbeatAt: new Date(),
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
        (("code" in error && error.code === 11000) ||
          ("message" in error &&
            typeof error.message === "string" &&
            error.message.includes("11000")))
      ) {
        return false;
      }
      throw error;
    }
  }

  public async releaseLock(experimentId: string, snapshotId: string) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: snapshotId,
      },
      {
        $set: {
          currentExecutionSnapshotId: null,
          lockHeartbeatAt: null,
          dateUpdated: new Date(),
        },
      },
    );
  }

  public async touchLockHeartbeat(experimentId: string, snapshotId: string) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: snapshotId,
      },
      { $set: { lockHeartbeatAt: new Date(), dateUpdated: new Date() } },
    );
  }

  public async getCurrentExecutionSnapshotId(
    experimentId: string,
  ): Promise<string | null> {
    const doc = await this._findOne({ experimentId });
    return doc?.currentExecutionSnapshotId ?? null;
  }

  public async updateByExperimentIdIfCurrentExecution(
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
