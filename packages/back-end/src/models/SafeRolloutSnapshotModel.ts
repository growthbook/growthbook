import {
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "back-end/src/routers/experiment-template/template.validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: experimentTemplateInterface,
  collectionName: "saferolloutsnapshots",
  idPrefix: "srsnp__",
  auditLog: {
    entity: "safeRolloutSnapshot",
    createEvent: "safeRolloutSnapshot.create",
    updateEvent: "safeRolloutSnapshot.update",
    deleteEvent: "safeRolloutSnapshot.delete",
  },
  globallyUniqueIds: false,
});

export class SafeRolloutSnapshotModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: ExperimentTemplateInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: ExperimentTemplateInterface,
    updates: ExperimentTemplateInterface
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates
    );
  }
  protected canDelete(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  // TODO: Implement this for OpenAPI
  //   public toApiInterface(project: ProjectInterface): ApiProject {
  //     return {
  //       id: project.id,
  //       name: project.name,
  //     };
  //   }
}
