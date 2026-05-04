import {
  ManagedBy,
  ProjectInterface,
  projectValidator,
  ApiProject,
} from "shared/validators";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { MakeModelClass } from "./BaseModel";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

  protected async beforeCreate(data: Partial<ProjectInterface>) {
    if (!data.publicId && data.name) {
      const baseSlug = slugify(data.name);
      if (!baseSlug) return; // name yields no slug (e.g. non-ASCII only); leave publicId unset
      let publicId = baseSlug;
      let counter = 1;
      const MAX_ATTEMPTS = 1000;

      while (counter <= MAX_ATTEMPTS) {
        const existing = await this._findOne({
          organization: this.context.org.id,
          publicId,
        });
        if (!existing) break;
        publicId = `${baseSlug}-${counter}`;
        counter++;
      }

      if (counter > MAX_ATTEMPTS) {
        throw new Error(
          `Failed to generate unique publicId for project "${data.name}" after ${MAX_ATTEMPTS} attempts`,
        );
      }

      data.publicId = publicId;
    } else if (data.publicId) {
      if (!/^[a-z0-9-]+$/.test(data.publicId)) {
        this.context.throwBadRequestError(
          "publicId must contain only lowercase letters, numbers, and dashes",
        );
      }

      const existing = await this._findOne({
        organization: this.context.org.id,
        publicId: data.publicId,
      });
      if (existing) {
        this.context.throwBadRequestError(
          `A project with publicId "${data.publicId}" already exists in this organization`,
        );
      }
    }
  }

  protected async beforeUpdate(
    original: ProjectInterface,
    updates: Partial<ProjectInterface>,
  ) {
    if (
      updates.publicId !== undefined &&
      updates.publicId !== original.publicId
    ) {
      if (!/^[a-z0-9-]+$/.test(updates.publicId)) {
        this.context.throwBadRequestError(
          "publicId must contain only lowercase letters, numbers, and dashes",
        );
      }

      const existing = await this._findOne({
        organization: this.context.org.id,
        publicId: updates.publicId,
      });
      if (existing && existing.id !== original.id) {
        this.context.throwBadRequestError(
          `A project with publicId "${updates.publicId}" already exists in this organization`,
        );
      }
    }
  }

  protected async afterUpdate(
    original: ProjectInterface,
    updates: Partial<ProjectInterface>,
  ) {
    if (
      updates.publicId !== undefined &&
      updates.publicId !== original.publicId
    ) {
      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys: getEnvironmentIdsFromOrg(this.context.org).map((env) => ({
          environment: env,
          project: "",
        })),
        treatEmptyProjectAsGlobal: true,
        auditContext: {
          event: "updated",
          model: "project",
          id: original.id,
        },
      });
    }
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
      description: project.description || "",
      publicId: project.publicId,
      dateCreated: project.dateCreated.toISOString(),
      dateUpdated: project.dateUpdated.toISOString(),
      settings: {
        statsEngine: project.settings?.statsEngine,
        confidenceLevel: project.settings?.confidenceLevel,
        pValueThreshold: project.settings?.pValueThreshold,
      },
    };
  }
}
