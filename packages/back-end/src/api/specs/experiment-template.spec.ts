import {
  apiExperimentTemplateValidator,
  apiListExperimentTemplatesValidator,
  apiCreateExperimentTemplateBody,
  apiUpdateExperimentTemplateBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const experimentTemplateApiSpec = {
  modelSingular: "experimentTemplate",
  modelPlural: "experimentTemplates",
  pathBase: "/experiment-templates",
  apiInterface: apiExperimentTemplateValidator,
  schemas: {
    createBody: apiCreateExperimentTemplateBody,
    updateBody: apiUpdateExperimentTemplateBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListExperimentTemplatesValidator,
  },
} satisfies OpenApiModelSpec;
export default experimentTemplateApiSpec;
