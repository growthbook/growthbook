import {
  ExperimentSnapshotInterface,
  legacyExperimentSnapshotValidator,
} from "back-end/src/validators/experiment-snapshot";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: legacyExperimentSnapshotValidator,
  collectionName: "experimenttemplates",
  idPrefix: "tmplt__",
  auditLog: {
    entity: "experimentTemplate",
    createEvent: "experimentTemplate.create",
    updateEvent: "experimentTemplate.update",
    deleteEvent: "experimentTemplate.delete",
  },
  globallyUniqueIds: false,
});

export class ExperimentSnapshotModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: ExperimentSnapshotInterface): boolean {
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: ExperimentSnapshotInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: ExperimentSnapshotInterface,
    updates: ExperimentSnapshotInterface
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates
    );
  }
  protected canDelete(doc: ExperimentSnapshotInterface): boolean {
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
