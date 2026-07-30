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

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === 11000) return true;
  return (
    "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("11000")
  );
}

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

  /** Legacy document, that we can use to migrate to the phase-scoped document. */
  public async getLegacyByExperimentIdWithoutPhase(experimentId: string) {
    return this._findOne({ experimentId, phase: { $exists: false } });
  }

  /**
   * IR row currently locked by this snapshot. Prefer over phase lookup in a
   * running runner: phase can be renumbered by concurrent compactPhases.
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
      // Another process minted or acquired this phase first.
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

  /**
   * Whether a live snapshot currently holds the lock for this phase. A lock is
   * live when it names an execution and its heartbeat has not gone stale. This
   * is the exact negation of the availability predicate in `acquireLock`.
   */
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
   * Collapse the phase-scoped documents back to a contiguous `0..n-1` sequence
   * after a phase deletion leaves a gap. Renumbering competes with a concurrent
   * `acquireLock` that may mint a document into a slot mid-shuffle, so each move
   * is guarded by the document's current phase and the pass re-drives until a
   * fresh read is already contiguous, tolerating the duplicate-key error a
   * colliding mint raises. Legacy phase-less documents are left untouched.
   */
  public async compactPhases(experimentId: string): Promise<void> {
    const collection = this._dangerousGetCollection();
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
