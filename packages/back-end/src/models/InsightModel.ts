import { InsightInterface, insightValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: insightValidator,
  collectionName: "insights",
  idPrefix: "insight_",
  auditLog: {
    entity: "insight",
    createEvent: "insight.create",
    updateEvent: "insight.update",
    deleteEvent: "insight.delete",
  },
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    tags: [],
    authors: [],
    supportingExperimentIds: [],
    contraryEvidence: [],
    projects: [],
  },
});

export class InsightModel extends BaseClass {
  protected canRead(doc: InsightInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canCreate(doc: InsightInterface): boolean {
    const projects = doc.projects && doc.projects.length ? doc.projects : [""];
    return projects.some((project) =>
      this.context.permissions.canCreateExperiment({ project }),
    );
  }

  // Only the owner or an org-settings admin can edit/delete a saved insight.
  // Everyone with read access can still comment via the discussion thread.
  protected canUpdate(doc: InsightInterface): boolean {
    if (doc.owner && doc.owner === this.context.userId) return true;
    if (this.context.superAdmin) return true;
    return this.context.permissions.canManageOrgSettings();
  }

  protected canDelete(doc: InsightInterface): boolean {
    return this.canUpdate(doc);
  }

  public async getByExperimentId(
    experimentId: string,
  ): Promise<InsightInterface[]> {
    return this._find({ supportingExperimentIds: experimentId });
  }
}
