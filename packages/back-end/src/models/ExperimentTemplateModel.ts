import {
  ApiExperimentTemplateInterface,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  experimentTemplateApiSpec,
  bulkImportExperimentTemplatesEndpoint,
} from "back-end/src/api/specs/experiment-template.spec";
import { MakeModelClass } from "./BaseModel";

const ID_PREFIX = "tmplt__";

const BaseClass = MakeModelClass({
  schema: experimentTemplateInterface,
  collectionName: "experimenttemplates",
  idPrefix: ID_PREFIX,
  auditLog: {
    entity: "experimentTemplate",
    createEvent: "experimentTemplate.create",
    updateEvent: "experimentTemplate.update",
    deleteEvent: "experimentTemplate.delete",
  },
  globallyUniquePrimaryKeys: false,
  defaultValues: {
    owner: "",
    targeting: {
      condition: "{}",
    },
  },
  apiConfig: {
    modelKey: "experimentTemplates",
    openApiSpec: experimentTemplateApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...bulkImportExperimentTemplatesEndpoint,
        reqHandler: async (req) => {
          let added = 0;
          let updated = 0;
          const normalizedIds = req.body.templates.map(({ id }) =>
            id.startsWith(ID_PREFIX) ? id : `${ID_PREFIX}${id}`,
          );
          const existingTemplates =
            await req.context.models.experimentTemplates.getByIds(
              normalizedIds,
            );
          const existingById = new Map(existingTemplates.map((t) => [t.id, t]));
          // Failures mid-loop are not rolled back — earlier writes remain committed.
          // This matches the behavior of other bulk-import endpoints (e.g. /bulk-import/facts).
          // The upsert semantics make a full retry safe: already-written IDs resolve to updates.
          for (const { id, data } of req.body.templates) {
            const normalizedId = id.startsWith(ID_PREFIX)
              ? id
              : `${ID_PREFIX}${id}`;
            const existing = existingById.get(normalizedId);
            if (existing) {
              await req.context.models.experimentTemplates.update(
                existing,
                data,
              );
              updated++;
            } else {
              const created =
                await req.context.models.experimentTemplates.create({
                  ...data,
                  id: normalizedId,
                  owner: "", // Will be inferred in BaseModel if possible
                });
              // Keep the map current so duplicate IDs in the same payload update
              // rather than attempting a second create (which would fail on the unique index).
              existingById.set(normalizedId, created);
              added++;
            }
          }
          return { added, updated };
        },
      }),
    ],
  },
});

export class ExperimentTemplatesModel extends BaseClass {
  // CRUD permission checks
  protected canCreate(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canCreateExperimentTemplate(doc);
  }
  protected canRead(doc: ExperimentTemplateInterface): boolean {
    return this.context.hasPermission("readData", doc.project || "");
  }
  protected canUpdate(
    existing: ExperimentTemplateInterface,
    _updates: UpdateProps<ExperimentTemplateInterface>,
    newDoc: ExperimentTemplateInterface,
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      newDoc,
    );
  }
  protected canDelete(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("templates");
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiExperimentTemplateInterface[]> {
    const { projectId } = req.query;
    const docs = await (projectId
      ? this._find({ project: projectId })
      : this.getAll());
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }
}
