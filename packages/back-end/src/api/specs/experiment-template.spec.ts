import { z } from "zod";
import {
  apiExperimentTemplateValidator,
  apiListExperimentTemplatesValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const experimentTemplateApiSpec = {
  modelSingular: "experimentTemplate",
  modelPlural: "experimentTemplates",
  pathBase: "/experiment-templates",
  apiInterface: apiExperimentTemplateValidator,
  schemas: {
    createBody: z.never(),
    updateBody: z.never(),
  },
  crudActions: ["list"],
  crudValidatorOverrides: {
    list: apiListExperimentTemplatesValidator,
  },
} satisfies OpenApiModelSpec;
export default experimentTemplateApiSpec;
