import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import {
  ExploratoryAnalysisRequest,
  exploratoryAnalysisRequestValidator,
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
   * Finds a runner's lock, held as the writer or as a reader, by snapshot ID.
   */
  public async getLockedBySnapshotId(experimentId: string, snapshotId: string) {
    return this._findOne({
      experimentId,
      $or: [
        { currentExecutionSnapshotId: snapshotId },
        { "readers.snapshotId": snapshotId },
      ],
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

  /**
   * Readers hold the lock together, but only while the writer slot is empty
   * and not alongside a reader already computing the same request.
   */
  public async acquireReaderLock({
    experimentId,
    phase,
    snapshotId,
    request,
    legacyExperimentSettingsHash,
  }: {
    experimentId: string;
    phase: number;
    snapshotId: string;
    request: ExploratoryAnalysisRequest;
    legacyExperimentSettingsHash: string;
  }): Promise<boolean> {
    const collection = this._dangerousGetCollection();
    const now = new Date();
    // Raw writes skip the model's validation, and the request is user input.
    // Parsing also fixes the key order that whole-object equality relies on.
    const validRequest = exploratoryAnalysisRequestValidator.parse(request);
    // Note: a dead reader's entry stays until the next writer clears the
    // list. It blocks nothing; purge here if the list ever grows.
    const liveSameRequest = {
      request: validRequest,
      heartbeatAt: {
        $gte: new Date(now.getTime() - INCREMENTAL_LOCK_STALE_MS),
      },
    };
    // Readers never take over a writer's slot, even a stale one: a crashed
    // update may have left the tables half-updated, so they wait for the next
    // writer or the cleanup job to empty it.
    const joinable = {
      organization: this.context.org.id,
      experimentId,
      currentExecutionSnapshotId: null,
      readers: { $not: { $elemMatch: liveSameRequest } },
    };
    const $push = {
      readers: { snapshotId, heartbeatAt: now, request: validRequest },
    };

    try {
      const existingPhase = await collection.updateOne(
        { ...joinable, phase },
        { $push, $set: { dateUpdated: now } },
      );
      if (existingPhase.matchedCount > 0) return true;

      // No upsert past this point: a breakdown only reads tables that an
      // Overall Results run has already recorded on a state document.
      const legacyPhase = await collection.updateOne(
        {
          ...joinable,
          phase: { $exists: false },
          experimentSettingsHash: legacyExperimentSettingsHash,
        },
        { $push, $set: { phase, dateUpdated: now } },
      );
      return legacyPhase.matchedCount > 0;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }

  /**
   * Evicts every reader once a writer holds the lock, returning their snapshot
   * IDs so the caller can cancel them. No reader can join after this: the
   * writer slot is already taken.
   */
  public async clearReaders(
    experimentId: string,
    writerId: string,
  ): Promise<string[]> {
    const { value } = await this._dangerousGetCollection().findOneAndUpdate(
      {
        organization: this.context.org.id,
        experimentId,
        currentExecutionSnapshotId: writerId,
      },
      { $set: { readers: [] } },
      { projection: { readers: 1 } },
    );
    const readers: NonNullable<IncrementalRefreshInterface["readers"]> =
      value?.readers ?? [];
    return readers.map((reader) => reader.snapshotId);
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

  // One method for reader and writer lock release because not all callers
  // such as snapshot cancellation know automatically whether they hold a
  // writer or reader lock.
  public async releaseLock(experimentId: string, snapshotId: string) {
    const collection = this._dangerousGetCollection();
    const experimentDocs = {
      organization: this.context.org.id,
      experimentId,
    };
    const writer = await collection.updateOne(
      { ...experimentDocs, currentExecutionSnapshotId: snapshotId },
      {
        $set: {
          currentExecutionSnapshotId: null,
          lockHeartbeatAt: null,
          dateUpdated: new Date(),
        },
      },
    );
    if (writer.matchedCount > 0) return;
    await collection.updateOne(
      { ...experimentDocs, "readers.snapshotId": snapshotId },
      { $pull: { readers: { snapshotId } }, $set: { dateUpdated: new Date() } },
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

  public async touchReaderHeartbeat(experimentId: string, snapshotId: string) {
    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        experimentId,
        "readers.snapshotId": snapshotId,
      },
      {
        $set: { "readers.$.heartbeatAt": new Date(), dateUpdated: new Date() },
      },
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
    const heartbeatAt =
      doc?.currentExecutionSnapshotId === snapshotId
        ? doc.lockHeartbeatAt
        : doc?.readers?.find((reader) => reader.snapshotId === snapshotId)
            ?.heartbeatAt;
    if (!heartbeatAt) return false;
    return Date.now() - heartbeatAt.getTime() < INCREMENTAL_LOCK_STALE_MS;
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
