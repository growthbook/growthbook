import { segmentValidator } from "../routers/segment/segment.validators";
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
  //MKTODO: Update the permission checks to use resource's projects
  protected canRead(): boolean {
    return this.context.hasPermission("readData", []);
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
}
