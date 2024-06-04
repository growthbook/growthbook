import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { z } from "zod";
import { ApiProject } from "../../types/openapi";
import { statsEngines } from "../util/constants";
import { baseSchema, MakeModelClass } from "./BaseModel";

export const statsEnginesValidator = z.enum(statsEngines);

export const projectSettingsValidator = z.object({
  statsEngine: statsEnginesValidator.default(DEFAULT_STATS_ENGINE),
});

export const projectValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string(),
    settings: projectSettingsValidator,
  })
  .strict();

export type StatsEngine = z.infer<typeof statsEnginesValidator>;
export type ProjectSettings = z.infer<typeof projectSettingsValidator>;
export type ProjectInterface = z.infer<typeof projectValidator>;

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
  globallyUniqueIds: true,
});

interface CreateProjectProps {
  name: string;
  description?: string;
  id?: string;
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
      statsEngine: DEFAULT_STATS_ENGINE,
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

  public toApiInterface(project: ProjectInterface): ApiProject {
    return {
      id: project.id,
      name: project.name,
      description: project.description || "",
      dateCreated: project.dateCreated.toISOString(),
      dateUpdated: project.dateUpdated.toISOString(),
      settings: {
        statsEngine: project.settings?.statsEngine || DEFAULT_STATS_ENGINE,
      },
    };
  }
}
