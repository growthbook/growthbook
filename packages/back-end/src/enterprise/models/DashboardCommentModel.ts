import { dashboardCommentThreadInterface } from "shared/enterprise";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: dashboardCommentThreadInterface,
  collectionName: "dashboardcomments",
  idPrefix: "dashc_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [{ fields: { organization: 1, dashboardId: 1 } }],
});

// Access is decided by the parent dashboard: only call this through services/dashboardComments.
export class DashboardCommentModel extends BaseClass {
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

  public getAllForDashboard(dashboardId: string) {
    return this._find({ dashboardId });
  }

  public async deleteAllForDashboard(dashboardId: string) {
    for (const thread of await this.getAllForDashboard(dashboardId)) {
      await this.delete(thread);
    }
  }
}
