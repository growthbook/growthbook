import { z } from "zod";
import { generateSlugFromName } from "shared/util";
import { ApiProject } from "back-end/types/openapi";
import { statsEngines } from "back-end/src/util/constants";
import {
  managedByValidator,
  ManagedBy,
} from "back-end/src/validators/managed-by";
import { logger } from "back-end/src/util/logger";
import { baseSchema, MakeModelClass } from "./BaseModel";
export const statsEnginesValidator = z.enum(statsEngines);

export const projectSettingsValidator = z.object({
  statsEngine: statsEnginesValidator.optional(),
});

export const projectValidator = baseSchema
  .extend({
    name: z.string(),
    uid: z.string(),
    description: z.string().default("").optional(),
    settings: projectSettingsValidator.default({}).optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type StatsEngine = z.infer<typeof statsEnginesValidator>;
export type ProjectSettings = z.infer<typeof projectSettingsValidator>;
export type ProjectInterface = z.infer<typeof projectValidator>;

export type LegacyProjectInterface = Omit<ProjectInterface, "uid"> & {
  uid?: string; // Optional in legacy documents
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
  additionalIndexes: [
    {
      fields: { uid: 1, organization: 1 },
      sparse: true, // Only index documents where uid exists (for migration compatibility)
    },
  ],
});

interface CreateProjectProps {
  name: string;
  uid: string;
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

  public async getById(id: string) {
    const doc = await super.getById(id);
    if (!doc) return null;

    // JIT migration: generate and save uid if missing (non-blocking)
    if (!doc.uid) {
      const uid = await this.generateUniqueUid(
        doc.name,
        doc.organization,
        doc.id,
      );
      // Persist non-blocking - don't await
      this._dangerousGetCollection()
        .updateOne(
          { id: doc.id, organization: doc.organization },
          { $set: { uid } },
        )
        .catch((err) => {
          // Log error but don't throw - this is non-blocking
          logger.error(err, "Failed to persist project uid during getById");
        });
      doc.uid = uid;
    }

    return doc;
  }

  public async getAll() {
    const docs = await super.getAll();

    // JIT migration: generate and save uid for any documents missing it (non-blocking)
    const updates: Promise<void>[] = [];
    for (const doc of docs) {
      if (!doc.uid) {
        const uid = await this.generateUniqueUid(
          doc.name,
          doc.organization,
          doc.id,
        );
        // Persist non-blocking - don't await
        updates.push(
          this._dangerousGetCollection()
            .updateOne(
              { id: doc.id, organization: doc.organization },
              { $set: { uid } },
            )
            .catch((err) => {
              // Log error but don't throw - this is non-blocking
              logger.error(
                err,
                `Failed to persist project uid during getAll for project ${doc.id}`,
              );
            })
            .then(() => undefined),
        );
        doc.uid = uid;
      }
    }

    // Fire off all updates but don't await them
    Promise.all(updates).catch(() => {
      // Errors already logged above
    });

    return docs;
  }

  protected async beforeUpdate(
    existing: z.infer<typeof projectValidator>,
    updates: Partial<z.infer<typeof projectValidator>>,
    newDoc: z.infer<typeof projectValidator>,
  ): Promise<void> {
    // JIT migration: generate uid if missing (for legacy documents)
    if (!newDoc.uid) {
      newDoc.uid = await this.generateUniqueUid(
        newDoc.name,
        newDoc.organization,
        newDoc.id,
      );
    }
  }

  private async generateUniqueUid(
    name: string,
    organization: string,
    id: string,
  ): Promise<string> {
    const baseUid = generateSlugFromName(name);
    if (!baseUid) {
      return id;
    }
    const existing = await this._dangerousGetCollection().findOne({
      organization,
      uid: baseUid,
    });

    if (baseUid && !existing) {
      return baseUid;
    }
    return id;
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
      uid: project.uid,
      description: project.description || "",
      dateCreated: project.dateCreated.toISOString(),
      dateUpdated: project.dateUpdated.toISOString(),
      settings: {
        statsEngine: project.settings?.statsEngine,
      },
    };
  }
}
