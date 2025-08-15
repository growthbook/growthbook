import mongoose from "mongoose";
import {
  dashboardTemplateInterface,
  DashboardTemplateInterface,
} from "back-end/src/enterprise/validators/dashboard-template";
import { MakeModelClass, UpdateProps } from "back-end/src/models/BaseModel";
import {
  ToInterface,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
export type DashboardTemplateDocument = mongoose.Document &
  DashboardTemplateInterface;

const BaseClass = MakeModelClass({
  schema: dashboardTemplateInterface,
  collectionName: "dashboardtemplates",
  idPrefix: "dashtmplt_",
  auditLog: {
    entity: "dashboardTemplate",
    createEvent: "dashboardTemplate.create",
    updateEvent: "dashboardTemplate.update",
    deleteEvent: "dashboardTemplate.delete",
  },
  globallyUniqueIds: true,
});

export const toInterface: ToInterface<DashboardTemplateInterface> = (doc) => {
  return removeMongooseFields(doc);
};

export class DashboardTemplateModel extends BaseClass {
  protected canCreate(_doc: DashboardTemplateDocument): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");
    return true;
  }

  protected canRead(_doc: DashboardTemplateDocument): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");
    return this.context.hasPermission("readData", "");
  }

  protected canUpdate(
    existing: DashboardTemplateDocument,
    updates: UpdateProps<DashboardTemplateDocument>,
  ): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === existing.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();

    const canManage = isOwner || isAdmin;
    if (canManage) return true;
    if ("title" in updates || "editLevel" in updates) {
      return false;
    }

    return existing.editLevel === "organization";
  }

  protected canDelete(doc: DashboardTemplateDocument): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === doc.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();
    return isOwner || isAdmin;
  }

  protected migrate(doc: unknown) {
    return toInterface(doc as DashboardTemplateDocument);
  }
}
