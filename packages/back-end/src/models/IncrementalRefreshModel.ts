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
  globallyUniqueIds: true,
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

  public async setCurrentExecutionSnapshotId(
    experimentId: string,
    snapshotId: string,
  ) {
    return this.upsertByExperimentId(experimentId, {
      currentExecutionSnapshotId: snapshotId,
    });
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
