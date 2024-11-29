import { SegmentInterface } from "back-end/types/segment";
import { getConfigSegments, usingFileConfig } from "back-end/src/init/config";
import { segmentValidator } from "back-end/src/routers/segment/segment.validators";
import { STORE_SEGMENTS_IN_MONGO } from "back-end/src/util/secrets";
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

type LegacySegmentInterface = Omit<SegmentInterface, "type"> & {
  type?: "SQL" | "FACT";
};

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

  public async getByFactTableId(
    factTableId: string
  ): Promise<SegmentInterface[]> {
    return await this._find({ factTableId });
  }

  protected migrate(legacySegment: LegacySegmentInterface): SegmentInterface {
    // if legacySegment doesn't have a type, it's a legacy, which only allowed SQL
    return { ...legacySegment, type: legacySegment.type || "SQL" };
  }

  protected async customValidation(segment: SegmentInterface): Promise<void> {
    if (segment.type === "SQL") {
      if (!segment.sql) {
        throw new Error(
          `${segment.name} is a SQL type Segment, but contains no SQL value`
        );
      }
    }

    if (segment.type === "FACT") {
      if (!segment.factTableId) {
        throw new Error(
          `${segment.name} is a FACT type Segment, but contains no factTableId`
        );
      }
    }
  }
}
