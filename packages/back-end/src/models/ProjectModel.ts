import { ApiProject } from "shared/types/openapi";
import {
  ManagedBy,
  ProjectInterface,
  ProjectSettings,
  projectValidator,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { queueSDKPayloadRefresh } from "../services/features";
import { logger } from "../util/logger";
import { getPayloadKeysForAllEnvs } from "./ExperimentModel";
import { MakeModelClass } from "./BaseModel";

type MigratedProject = Omit<ProjectInterface, "settings"> & {
  settings: Partial<ProjectInterface["settings"]>;
};

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
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    description: "",
    settings: {},
  },
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

  protected migrate(doc: MigratedProject) {
    const settings = {
      ...(doc.settings || {}),
    };

    return { ...doc, settings };
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

  protected async afterUpdate(
    existing: ProjectInterface,
    updates: Partial<ProjectInterface>,
    newDoc: ProjectInterface,
    writeOptions?: never,
  ): Promise<void> {
    await super.afterUpdate(existing, updates, newDoc, writeOptions);
    
    // Only refresh SDK payload cache if publicId changed
    if (existing.publicId !== newDoc.publicId) {
      const payloadKeys = getPayloadKeysForAllEnvs(
        this.context as ReqContext | ApiReqContext,
        [newDoc.id],
      );
      queueSDKPayloadRefresh({
        context: this.context as ReqContext | ApiReqContext,
        payloadKeys,
        auditContext: {
          event: "updated",
          model: "project",
          id: newDoc.id,
        },
      });
    }
  }
}
