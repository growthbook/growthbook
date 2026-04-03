import { z } from "zod";
import {
  ApiExperimentTemplateInterface,
  apiListExperimentTemplatesValidator,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { ApiRequest } from "back-end/src/util/handler";
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
              await req.context.models.experimentTemplates.create({
                ...data,
                id: normalizedId,
              });
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
    updates: ExperimentTemplateInterface,
  ): boolean {
    return this.context.permissions.canUpdateExperimentTemplate(
      existing,
      updates,
    );
  }
  protected canDelete(doc: ExperimentTemplateInterface): boolean {
    return this.context.permissions.canDeleteExperimentTemplate(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("templates");
  }

  public async handleApiList(
    req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ): Promise<ApiExperimentTemplateInterface[]> {
    // Typecast due to the method signature using ZodTypeAnys since a narrower type breaks ApiModel
    const { projectId } = req.query as z.infer<
      (typeof apiListExperimentTemplatesValidator)["querySchema"]
    >;
    const docs = await (projectId
      ? this._find({ project: projectId })
      : this.getAll());
    return docs.map(this.toApiInterface.bind(this));
  }
}
