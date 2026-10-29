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

export const STALE_LOCK_FULL_REFRESH_REASON =
  "An earlier update stopped without releasing its lock, so the cache tables may hold rows it never recorded.";

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
    return [{ currentExecutionSnapshotId: null }, ...this.getStaleLockFilter()];
  }

  private getStaleLockFilter() {
    const staleThreshold = new Date(Date.now() - INCREMENTAL_LOCK_STALE_MS);
    return [
      { lockHeartbeatAt: { $lt: staleThreshold, $ne: null } },
      { lockHeartbeatAt: null, dateUpdated: { $lt: staleThreshold } },
    ];
  }

  /**
   * Takes the lock on an existing document. Taking it from a run that never
   * released it also flags this document's tables in the same write: that run
   * may still be appending rows it will never record. Only this document is
   * flagged, since the stale lock was on it.
   */
  private async claimLock(
    filter: Record<string, unknown>,
    fields: Record<string, unknown>,
    holderId: string,
  ): Promise<boolean> {
    const collection = this._dangerousGetCollection();
    const free = await collection.updateOne(
      { ...filter, currentExecutionSnapshotId: null },
      { $set: fields },
    );
    if (free.matchedCount > 0) return true;
    const stale = await collection.updateOne(
      {
        ...filter,
        currentExecutionSnapshotId: { $ne: null },
        $or: this.getStaleLockFilter(),
      },
      {
        $set: {
          ...fields,
          fullRefreshRequired: {
            reason: STALE_LOCK_FULL_REFRESH_REASON,
            snapshotId: null,
            takenOverBy: holderId,
            date: new Date(),
          },
        },
      },
    );
    return stale.matchedCount > 0;
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
    const lockFields = {
      currentExecutionSnapshotId: snapshotId,
      lockHeartbeatAt: new Date(),
      dateUpdated: new Date(),
    };

    try {
      if (
        await this.claimLock(
          { organization: this.context.org.id, experimentId, phase },
          lockFields,
          snapshotId,
        )
      ) {
        return true;
      }

      if (
        await this.claimLock(
          {
            organization: this.context.org.id,
            experimentId,
            phase: { $exists: false },
            experimentSettingsHash: legacyExperimentSettingsHash,
          },
          { phase, ...lockFields },
          snapshotId,
        )
      ) {
        return true;
      }

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

      // Only creates the document: a stale lock must go through claimLock,
      // which flags the tables as it takes it.
      const insertedPhase = await collection.updateOne(
        {
          organization: this.context.org.id,
          experimentId,
          phase,
          currentExecutionSnapshotId: null,
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
    // Only creates the document; an existing one goes through claimLock.
    const claimFilter = {
      organization: this.context.org.id,
      experimentId,
      phase,
      currentExecutionSnapshotId: null,
    };
    const claimFields = {
      currentExecutionSnapshotId: token,
      lockHeartbeatAt: new Date(),
      dateUpdated: new Date(),
    };

    try {
      if (
        await this.claimLock(
          { organization: this.context.org.id, experimentId, phase },
          claimFields,
          token,
        )
      ) {
        return true;
      }

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

  /**
   * Releases an interrupted run's lock and, in the same write, forgets the
   * cache tables it may have appended to. Returns false if the run no longer
   * held the lock, in which case nothing was changed.
   */
  public async releaseLockAfterInterruptedRun(
    experimentId: string,
    snapshotId: string,
    {
      metricGroupIdsToRebuild,
      forceFullRefresh,
    }: { metricGroupIdsToRebuild: string[]; forceFullRefresh: boolean },
  ): Promise<boolean> {
    const pullGroups = { groupId: { $in: metricGroupIdsToRebuild } };
    const result = await this._dangerousGetCollection().updateOne(
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
          ...(forceFullRefresh ? { unitsTableFullName: null } : {}),
        },
        ...(metricGroupIdsToRebuild.length
          ? {
              $pull: {
                metricSources: pullGroups,
                metricCovariateSources: pullGroups,
              },
            }
          : {}),
      },
    );
    return result.matchedCount > 0;
  }

  /**
   * Flags every phase document of the experiment so its next refresh is a
   * full one. Unfenced: used when the lock has already moved on. Every phase,
   * because phases can be renumbered after the interrupted run took its lock.
   */
  public async requireFullRefresh(
    experimentId: string,
    { reason, snapshotId }: { reason: string; snapshotId: string },
  ) {
    await this._dangerousGetCollection().updateMany(
      { organization: this.context.org.id, experimentId },
      {
        $set: {
          fullRefreshRequired: { reason, snapshotId, date: new Date() },
          dateUpdated: new Date(),
        },
      },
    );
  }

  /**
   * Clears the flag for a full refresh that still holds the lock, unless the
   * flag was set after that refresh started.
   */
  public async clearFullRefreshRequired(
    experimentId: string,
    snapshotId: string,
    refreshStartedAt: Date,
  ): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: snapshotId,
        // A flag set when this refresh took a stale lock is its own to clear.
        $or: [
          { "fullRefreshRequired.date": { $lt: refreshStartedAt } },
          { "fullRefreshRequired.takenOverBy": snapshotId },
        ],
      },
      { $set: { fullRefreshRequired: null, dateUpdated: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  /**
   * Applies an interrupted run's cleanup to a phase document nobody holds the
   * lock on, e.g. when the run was already concluded once. Returns false when
   * another run holds the lock.
   */
  public async cleanUpUnlockedPhase(
    experimentId: string,
    phase: number,
    {
      metricGroupIdsToRebuild,
      forceFullRefresh,
    }: { metricGroupIdsToRebuild: string[]; forceFullRefresh: boolean },
  ): Promise<boolean> {
    const pullGroups = { groupId: { $in: metricGroupIdsToRebuild } };
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        phase,
        currentExecutionSnapshotId: null,
      },
      {
        $set: {
          dateUpdated: new Date(),
          ...(forceFullRefresh ? { unitsTableFullName: null } : {}),
        },
        ...(metricGroupIdsToRebuild.length
          ? {
              $pull: {
                metricSources: pullGroups,
                metricCovariateSources: pullGroups,
              },
            }
          : {}),
      },
    );
    return result.matchedCount > 0;
  }

  /**
   * The commit point for a run's results: records them only while the run
   * still holds the lock and, when `requireUnflagged`, no interrupted run has
   * flagged the tables. Returns false when nothing was recorded.
   */
  public async commitRunResults(
    experimentId: string,
    snapshotId: string,
    {
      materialized,
      requireUnflagged,
    }: { materialized: boolean; requireUnflagged: boolean },
  ): Promise<boolean> {
    const result = await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: snapshotId,
        ...(requireUnflagged ? { fullRefreshRequired: null } : {}),
      },
      {
        $set: {
          dateUpdated: new Date(),
          ...(materialized ? { materializedBySnapshotId: snapshotId } : {}),
        },
      },
    );
    return result.matchedCount > 0;
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
