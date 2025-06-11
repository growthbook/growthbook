import mongoose from "mongoose";
import {
  dashboardInstanceInterface,
  DashboardInstanceInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { dashboardBlockSchema } from "./DashboardBlockModel";

export const dashboardInstanceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organizationId: String,
  dateCreated: Date,
  dateUpdated: Date,
  title: String,
  defaultMetricId: String,
  defaultDimensionId: String,
  baselineRow: String,
  defaultDimensionValues: [String],
  defaultVariationIds: [String],
  dateStart: Date,
  dateEnd: Date,
  blocks: [dashboardBlockSchema],
});

dashboardInstanceSchema.index({
  organizationId: 1,
  dateCreated: -1,
});

export type DashboardInstanceDocument = mongoose.Document &
  DashboardInstanceInterface;

const BaseClass = MakeModelClass({
  schema: dashboardInstanceInterface,
  collectionName: "dashboardinstances",
  idPrefix: "dashinst_",
  auditLog: {
    entity: "dashboardInstance",
    createEvent: "dashboardInstance.create",
    updateEvent: "dashboardInstance.update",
    deleteEvent: "dashboardInstance.delete",
  },
  globallyUniqueIds: true,
});

export class DashboardInstanceModel extends BaseClass {
  protected canCreate(_doc: DashboardInstanceInterface): boolean {
    return true;
    // TODO - define permissions helpers
    // return this.context.permissions.canCreateDashboardInstance(doc);
  }

  protected canRead(_doc: DashboardInstanceInterface): boolean {
    return this.context.hasPermission("readData", "");
  }
  protected canUpdate(
    _existing: DashboardInstanceInterface,
    _updates: DashboardInstanceInterface
  ): boolean {
    return true;
    // TODO - define permissions helpers
    // return this.context.permissions.canUpdateDashboardInstance(
    //   existing,
    //   updates
    // );
  }
  protected canDelete(_doc: DashboardInstanceInterface): boolean {
    return true;
    // TODO - define permissions helpers
    // return this.context.permissions.canDeleteDashboardInstance(doc);
  }
}
