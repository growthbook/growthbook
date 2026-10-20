import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import {
  IncrementalRefreshInterface,
  incrementalRefreshValidator,
} from "shared/validators";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
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
      fields: { organization: 1, experimentId: 1, phase: 1 },
      unique: true,
    },
  ],
  indexesToRemove: ["organization_1_experimentId_1"],
});

export class IncrementalRefreshModel extends BaseClass {
  public async getByExperimentIdAndPhase(experimentId: string, phase: number) {
    return this._findOne({ experimentId, phase });
  }

  public async getLegacyByExperimentIdWithoutPhase(experimentId: string) {
    return this._findOne({ experimentId, phase: { $exists: false } });
  }

  /**
   * Finds a runner's lock by snapshot ID because phase can be renumbered.
   */
  public async getLockedBySnapshotId(experimentId: string, snapshotId: string) {
    return this._findOne({
      experimentId,
      currentExecutionSnapshotId: snapshotId,
    });
  }

  private getAvailableLockFilter() {
    const staleThreshold = new Date(Date.now() - INCREMENTAL_LOCK_STALE_MS);
    return [
      { currentExecutionSnapshotId: null },
      { lockHeartbeatAt: { $lt: staleThreshold, $ne: null } },
      { lockHeartbeatAt: null, dateUpdated: { $lt: staleThreshold } },
    ];
  }

  private newPhaseDoc(experimentId: string, phase: number) {
    return {
      id: uniqid("ir_"),
      organization: this.context.org.id,
      experimentId,
      phase,
      dateCreated: new Date(),
      unitsTableFullName: null,
      unitsMaxTimestamp: null,
      unitsDimensions: [],
      metricSources: [],
      metricCovariateSources: [],
      experimentSettingsHash: null,
    };
  }

  public async acquireLock({
    experimentId,
    phase,
    snapshotId,
    legacyExperimentSettingsHash,
  }: {
    experimentId: string;
    phase: number;
    snapshotId: string;
    legacyExperimentSettingsHash: string;
  }): Promise<boolean> {
    const collection = this._dangerousGetCollection();
    const lockAvailable = this.getAvailableLockFilter();
    const lockFields = {
      currentExecutionSnapshotId: snapshotId,
      lockHeartbeatAt: new Date(),
      dateUpdated: new Date(),
    };

    try {
      const existingPhase = await collection.updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          phase,
          $or: lockAvailable,
        },
        { $set: lockFields },
      );
      if (existingPhase.matchedCount > 0) return true;

      const legacyPhase = await collection.updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          phase: { $exists: false },
          experimentSettingsHash: legacyExperimentSettingsHash,
          $or: lockAvailable,
        },
        { $set: { phase, ...lockFields } },
      );
      if (legacyPhase.matchedCount > 0) return true;

      const conflictingDoc = await collection.findOne(
        {
          organization: this.context.org.id,
          experimentId,
          $or: [
            { phase },
            {
              phase: { $exists: false },
              experimentSettingsHash: legacyExperimentSettingsHash,
            },
          ],
        },
        { projection: { _id: 1 } },
      );
      if (conflictingDoc) return false;

      const insertedPhase = await collection.updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          phase,
          $or: lockAvailable,
        },
        {
          $set: lockFields,
          $setOnInsert: this.newPhaseDoc(experimentId, phase),
        },
        { upsert: true },
      );
      return (
        (insertedPhase.upsertedCount ?? 0) > 0 ||
        (insertedPhase.matchedCount ?? 0) > 0
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  public async acquirePhaseSlotForMutation(
    experimentId: string,
    phase: number,
    token: string,
  ): Promise<boolean> {
    const collection = this._dangerousGetCollection();
    const claimFilter = {
      organization: this.context.org.id,
      experimentId,
      phase,
      $or: this.getAvailableLockFilter(),
    };
    const claimFields = {
      currentExecutionSnapshotId: token,
      lockHeartbeatAt: new Date(),
      dateUpdated: new Date(),
    };

    try {
      const existing = await collection.updateOne(claimFilter, {
        $set: claimFields,
      });
      if (existing.matchedCount > 0) return true;

      const heldByRefresh = await collection.findOne(
        { organization: this.context.org.id, experimentId, phase },
        { projection: { _id: 1 } },
      );
      if (heldByRefresh) return false;

      const claimed = await collection.updateOne(
        claimFilter,
        {
          $set: claimFields,
          $setOnInsert: this.newPhaseDoc(experimentId, phase),
        },
        { upsert: true },
      );
      return (
        (claimed.upsertedCount ?? 0) > 0 || (claimed.matchedCount ?? 0) > 0
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
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

  public async isLockedBySnapshotId(
    experimentId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const doc = await this.getLockedBySnapshotId(experimentId, snapshotId);
    return doc !== null;
  }

  public async hasFreshLockHeartbeat(
    experimentId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const doc = await this.getLockedBySnapshotId(experimentId, snapshotId);
    if (!doc?.lockHeartbeatAt) return false;
    return (
      Date.now() - doc.lockHeartbeatAt.getTime() < INCREMENTAL_LOCK_STALE_MS
    );
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

  public async deleteByExperimentIdAndPhase(
    experimentId: string,
    phase: number,
  ) {
    await this._dangerousGetCollection().deleteOne({
      organization: this.context.org.id,
      experimentId,
      phase,
    });
  }

  public async shiftPhasesDownAfterDelete(
    experimentId: string,
    deletedPhase: number,
  ): Promise<void> {
    const collection = this._dangerousGetCollection();
    const docs = await collection
      .find(
        {
          organization: this.context.org.id,
          experimentId,
          phase: { $gt: deletedPhase },
        },
        { projection: { phase: 1 } },
      )
      .sort({ phase: 1 })
      .toArray();

    for (const doc of docs) {
      try {
        const moved = await collection.updateOne(
          { _id: doc._id, phase: doc.phase },
          { $set: { phase: doc.phase - 1, dateUpdated: new Date() } },
        );
        if (moved.matchedCount === 1) continue;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      await collection.deleteOne({ _id: doc._id });
      logger.warn(
        { experimentId, phase: doc.phase, deletedPhase },
        "Dropped an incremental refresh state document that could not be renumbered after a phase delete",
      );
    }
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
