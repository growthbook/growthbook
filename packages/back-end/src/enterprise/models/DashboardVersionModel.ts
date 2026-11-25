import { dashboardVersionInterface } from "shared/enterprise";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: dashboardVersionInterface,
  collectionName: "dashboardversions",
  idPrefix: "dashv_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    // Also what limits a dashboard to one draft: the draft's number is fixed.
    {
      fields: { organization: 1, dashboardId: 1, version: 1 },
      unique: true,
    },
  ],
});

// Access is decided by the parent dashboard: only call this through services/dashboardVersions.
export class DashboardVersionModel extends BaseClass {
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public getDraft(dashboardId: string) {
    return this._findOne({ dashboardId, status: "draft" });
  }

  public getAllForDashboard(dashboardId: string) {
    return this._find({ dashboardId });
  }

  public async deleteAllForDashboard(dashboardId: string) {
    for (const version of await this.getAllForDashboard(dashboardId)) {
      await this.delete(version);
    }
  }
}
