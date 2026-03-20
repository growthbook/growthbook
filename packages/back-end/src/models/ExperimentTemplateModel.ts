import { z } from "zod";
import {
  ApiExperimentTemplateInterface,
  apiListExperimentTemplatesValidator,
  experimentTemplateInterface,
  ExperimentTemplateInterface,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { ApiRequest } from "back-end/src/util/handler";
import { experimentTemplateApiSpec } from "back-end/src/api/specs/experiment-template.spec";
import { MakeModelClass } from "./BaseModel";

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
    openApiSpec: experimentTemplateApiSpec,
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
