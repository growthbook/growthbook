import { SegmentInterface } from "@back-end/types/segment";
import { getConfigSegments, usingFileConfig } from "../init/config";
import { segmentValidator } from "../routers/segment/segment.validators";
import { STORE_SEGMENTS_IN_MONGO } from "../util/secrets";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: segmentValidator,
  collectionName: "segments",
  idPrefix: "seg_",
  auditLog: {
    entity: "segment",
    createEvent: "segment.create",
    updateEvent: "segment.update",
    deleteEvent: "segment.delete",
  },
  globallyUniqueIds: false,
  readonlyFields: ["datasource"],
});

export class SegmentModel extends BaseClass {
  protected canRead(): boolean {
    return this.context.permissions.canReadSingleProjectResource("");
  }
  protected canCreate(): boolean {
    return this.context.permissions.canCreateSegment();
  }
  protected canUpdate(): boolean {
    return this.context.permissions.canUpdateSegment();
  }
  protected canDelete(): boolean {
    return this.context.permissions.canDeleteSegment();
  }
  protected useConfigFile(): boolean {
    if (usingFileConfig() && !STORE_SEGMENTS_IN_MONGO) {
      return true;
    }
    return false;
  }
  protected getConfigDocuments() {
    if (!this.useConfigFile) return [];

    return getConfigSegments(this.context.org.id);
  }
  public async getByDataSource(
    datasourceId: string
  ): Promise<SegmentInterface[]> {
    return await this._find({ datasource: datasourceId });
  }
}
