import {
  IncrementalRefreshInterface,
  incrementalRefreshValidator,
} from "back-end/src/validators/incremental-refresh";
import { MakeModelClass, UpdateProps } from "./BaseModel";

export const COLLECTION_NAME = "incrementalrefresh";

const BaseClass = MakeModelClass({
  schema: incrementalRefreshValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "ir_",
  auditLog: {
    entity: "incrementalRefresh",
    createEvent: "incrementalRefresh.create",
    updateEvent: "incrementalRefresh.update",
    deleteEvent: "incrementalRefresh.delete",
  },
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
  public async upsertByExperimentId(
    experimentId: string,
    data: Pick<
      IncrementalRefreshInterface,
      "unitsTableFullName" | "lastScannedTimestamp"
    >
  ) {
    const existing = await this._findOne({ experimentId });
    if (existing) {
      return this.update(existing, data);
    }
    return this.create({ experimentId, ...data });
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
    _newDoc: IncrementalRefreshInterface
  ) {
    return true;
  }
  protected canDelete(_existing: IncrementalRefreshInterface) {
    return true;
  }
}
