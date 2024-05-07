import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { z } from "zod";
import { ApiProject } from "../../types/openapi";
import { ProjectInterface, ProjectSettings } from "../../types/project";
import { statsEngines } from "../util/constants";
import { baseSchema, MakeModelClass } from "./BaseModel";

const projectValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string(),
    settings: z.object({
      statsEngine: z.enum(statsEngines),
    }),
  })
  .strict();

const BaseClass = MakeModelClass({
  schema: projectValidator,
  collectionName: "projects",
  idPrefix: "prj__",
  auditLog: {
    entity: "project",
    createEvent: "project.create",
    updateEvent: "project.update",
    deleteEvent: "project.delete",
  },
  projectScoping: "none",
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

  protected migrate(doc: z.infer<typeof projectValidator>) {
    return { ...doc, settings: doc.settings || {} };
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
