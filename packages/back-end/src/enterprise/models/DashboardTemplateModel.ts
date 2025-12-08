/* eslint-disable @typescript-eslint/no-unused-vars */
import mongoose from "mongoose";
import { UpdateProps } from "shared/types/base-model";
import {
  dashboardTemplateInterface,
  DashboardTemplateInterface,
} from "back-end/src/enterprise/validators/dashboard-template";
import { MakeModelClass } from "back-end/src/models/BaseModel";
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
    //TODO: Implement this logic
    return true;
  }

  protected canRead(_doc: DashboardTemplateDocument): boolean {
    //TODO: Implement this logic
    return true;
  }

  protected canUpdate(
    existing: DashboardTemplateDocument,
    updates: UpdateProps<DashboardTemplateDocument>,
  ): boolean {
    //TODO: Implement this logic
    return true;
  }

  protected canDelete(doc: DashboardTemplateDocument): boolean {
    //TODO: Implement this logic
    return true;
  }

  protected migrate(doc: unknown) {
    return toInterface(doc as DashboardTemplateDocument);
  }
}
