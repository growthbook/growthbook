import { ManagedBy } from "shared/validators";
import { ApiProject } from "back-end/types/openapi";
import {
  ProjectInterface,
  ProjectSettings,
  projectValidator,
} from "back-end/src/validators/projects";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { refreshSDKPayloadCache } from "../services/features";
import { logger } from "../util/logger";
import { getPayloadKeysForAllEnvs } from "./ExperimentModel";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: projectValidator,
  collectionName: "projects",
  idPrefix: "prj_",
  auditLog: {
    entity: "project",
    createEvent: "project.create",
    updateEvent: "project.update",
    deleteEvent: "project.delete",
  },
  globallyUniqueIds: true,
});

interface CreateProjectProps {
  name: string;
  publicId?: string;
  description?: string;
  id?: string;
  managedBy?: ManagedBy;
}

export class ProjectModel extends BaseClass {
  protected canRead(doc: ProjectInterface) {
    return this.context.permissions.canReadSingleProjectResource(doc.id);
  }

  protected canCreate() {
    return this.context.permissions.canCreateProjects();
  }

  protected canUpdate(doc: ProjectInterface) {
    return this.context.permissions.canUpdateProject(doc.id);
  }

  protected canDelete(doc: ProjectInterface) {
    return this.context.permissions.canDeleteProject(doc.id);
  }

  public create(project: CreateProjectProps) {
    return super.create({ ...project, settings: {} });
  }

  public updateSettingsById(id: string, settings: Partial<ProjectSettings>) {
    return super.updateById(id, { settings });
  }

  // Warning: This function is only used internally at the moment.
  // Make sure to add permission check if this functions gets
  // used in a context that needs it.
  public async removeManagedBy(managedBy: Partial<ManagedBy>) {
    await super._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        managedBy,
      },
      {
        $unset: {
          managedBy: 1,
        },
      },
    );
  }

  public async ensureProjectsExist(projectIds: string[]) {
    const projects = await this.getByIds(projectIds);
    if (projects.length !== projectIds.length) {
      throw new Error(
        `Invalid project ids: ${projectIds
          .filter((id) => !projects.find((p) => p.id === id))
          .join(", ")}`,
      );
    }
  }

  public toApiInterface(project: ProjectInterface): ApiProject {
    return {
      id: project.id,
      name: project.name,
      publicId: project.publicId,
      description: project.description || "",
      dateCreated: project.dateCreated.toISOString(),
      dateUpdated: project.dateUpdated.toISOString(),
      settings: {
        statsEngine: project.settings?.statsEngine,
      },
    };
  }

  protected async afterCreate(
    doc: ProjectInterface,
    writeOptions?: never,
  ): Promise<void> {
    await super.afterCreate(doc, writeOptions);
    // Refresh SDK payload cache for all environments
    const payloadKeys = getPayloadKeysForAllEnvs(
      this.context as ReqContext | ApiReqContext,
      [doc.id],
    );
    refreshSDKPayloadCache(
      this.context as ReqContext | ApiReqContext,
      payloadKeys,
    ).catch((e) => {
      logger.error(
        e,
        "Error refreshing SDK payload cache after project create",
      );
    });
  }

  protected async afterUpdate(
    existing: ProjectInterface,
    updates: Partial<ProjectInterface>,
    newDoc: ProjectInterface,
    writeOptions?: never,
  ): Promise<void> {
    await super.afterUpdate(existing, updates, newDoc, writeOptions);
    // Refresh SDK payload cache for all environments
    const payloadKeys = getPayloadKeysForAllEnvs(
      this.context as ReqContext | ApiReqContext,
      [newDoc.id],
    );
    refreshSDKPayloadCache(
      this.context as ReqContext | ApiReqContext,
      payloadKeys,
    ).catch((e) => {
      logger.error(
        e,
        "Error refreshing SDK payload cache after project update",
      );
    });
  }

  protected async afterDelete(
    doc: ProjectInterface,
    writeOptions?: never,
  ): Promise<void> {
    await super.afterDelete(doc, writeOptions);
    // Refresh SDK payload cache for all environments
    const payloadKeys = getPayloadKeysForAllEnvs(
      this.context as ReqContext | ApiReqContext,
      [doc.id],
    );
    refreshSDKPayloadCache(
      this.context as ReqContext | ApiReqContext,
      payloadKeys,
    ).catch((e) => {
      logger.error(
        e,
        "Error refreshing SDK payload cache after project delete",
      );
    });
  }
}
