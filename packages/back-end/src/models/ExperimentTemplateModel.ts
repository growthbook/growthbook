import { z } from "zod";
import {
  apiExperimentTemplateValidator,
  ApiExperimentTemplateInterface,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { applyFilter } from "back-end/src/util/handler";
import { MakeModelClass } from "./BaseModel";

const listExperimentTemplatesValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional().describe("Filter by project id"),
  }),
  paramsSchema: z.never(),
};

const listExperimentTemplatesReturn = z.strictObject({
  experimentTemplates: z.array(apiExperimentTemplateValidator),
});
type ListExperimentTemplatesReturn = z.infer<
  typeof listExperimentTemplatesReturn
>;

const BaseClass = MakeModelClass({
  schema: experimentTemplateInterface,
  collectionName: "experimenttemplates",
  idPrefix: "tmplt__",
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
    modelSingular: "experimentTemplate",
    modelPlural: "experimentTemplates",
    apiInterface: apiExperimentTemplateValidator,
    schemas: {
      createBody: z.never(),
      updateBody: z.never(),
    },
    pathBase: "/experiment-templates",
    customHandlers: [
      defineCustomApiHandler({
        pathFragment: "",
        verb: "get",
        operationId: "listExperimentTemplates",
        summary: "Get all experiment templates",
        validator: listExperimentTemplatesValidator,
        zodReturnObject: listExperimentTemplatesReturn,
        reqHandler: async (req): Promise<ListExperimentTemplatesReturn> => {
          const templates =
            await req.context.models.experimentTemplates.getAllAsApiInterface();
          return {
            experimentTemplates: templates.filter((t) =>
              applyFilter(req.query.projectId, t.project),
            ),
          };
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

  public async getAllAsApiInterface(): Promise<
    ApiExperimentTemplateInterface[]
  > {
    const templates = await this.getAll();
    return templates.map((t) => this.toApiInterface(t));
  }
}
