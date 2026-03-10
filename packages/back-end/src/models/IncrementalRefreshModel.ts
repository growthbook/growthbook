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
      ...data,
    });
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
