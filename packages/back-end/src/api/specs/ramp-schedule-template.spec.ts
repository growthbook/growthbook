import { z } from "zod";
import {
  apiRampScheduleTemplateValidator,
  apiTemplateRampStep,
  templateEndPatchValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const rampScheduleTemplateApiSpec = {
  modelSingular: "rampScheduleTemplate",
  modelPlural: "rampScheduleTemplates",
  pathBase: "/ramp-schedule-templates",
  apiInterface: apiRampScheduleTemplateValidator,
  schemas: {
    createBody: z.object({
      name: z.string(),
      steps: z.array(apiTemplateRampStep),
      endPatch: templateEndPatchValidator.optional(),
      official: z.boolean().optional(),
    }),
    updateBody: z.object({
      name: z.string().optional(),
      steps: z.array(apiTemplateRampStep).optional(),
      endPatch: templateEndPatchValidator.optional(),
      official: z.boolean().optional(),
    }),
  },
  includeDefaultCrud: true,
} satisfies OpenApiModelSpec;
export default rampScheduleTemplateApiSpec;
