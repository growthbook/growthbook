import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import {
  IncrementalRefreshInterface,
  incrementalRefreshValidator,
} from "shared/validators";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
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
    const staleThreshold = new Date(Date.now() - INCREMENTAL_LOCK_STALE_MS);
    const collection = this._dangerousGetCollection();
    const lockAvailable = [
      { currentExecutionSnapshotId: null },
      { lockHeartbeatAt: { $lt: staleThreshold, $ne: null } },
      { lockHeartbeatAt: null, dateUpdated: { $lt: staleThreshold } },
    ];
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
          $setOnInsert: {
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
          },
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

  public async isPhaseLockActive(
    experimentId: string,
    phase: number,
  ): Promise<boolean> {
    const staleThreshold = new Date(Date.now() - INCREMENTAL_LOCK_STALE_MS);
    const doc = await this._dangerousGetCollection().findOne({
      organization: this.context.org.id,
      experimentId,
      phase,
      currentExecutionSnapshotId: { $ne: null },
      $or: [
        { lockHeartbeatAt: { $gte: staleThreshold } },
        { lockHeartbeatAt: null, dateUpdated: { $gte: staleThreshold } },
      ],
    });
    return doc !== null;
  }

  /**
   * Retries after duplicate-key conflicts with concurrent lock acquisition.
   */
  public async compactPhases(experimentId: string): Promise<void> {
    const collection = this._dangerousGetCollection();
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const docs = await collection
        .find(
          {
            organization: this.context.org.id,
            experimentId,
            phase: { $exists: true },
          },
          { projection: { phase: 1 } },
        )
        .sort({ phase: 1 })
        .toArray();

      if (docs.every((doc, index) => doc.phase === index)) return;

      for (let index = 0; index < docs.length; index++) {
        const doc = docs[index];
        if (doc.phase === index) continue;
        try {
          await collection.updateOne(
            { _id: doc._id, phase: doc.phase },
            { $set: { phase: index, dateUpdated: new Date() } },
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) break;
          throw error;
        }
      }
    }
    throw new Error(
      "Could not renumber incremental refresh phases after phase deletion; a refresh may be running concurrently.",
    );
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
