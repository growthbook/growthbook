import { z } from "zod";
import {
  apiRampScheduleTemplateValidator,
  apiTemplateRampStep,
  lockdownConfigSchema,
  rampMonitoringConfig,
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
      monitoringConfig: rampMonitoringConfig.nullish(),
      lockdownConfig: lockdownConfigSchema.optional(),
    }),
    updateBody: z.object({
      name: z.string().optional(),
      steps: z.array(apiTemplateRampStep).optional(),
      endPatch: templateEndPatchValidator.optional(),
      official: z.boolean().optional(),
      monitoringConfig: rampMonitoringConfig.nullish(),
      lockdownConfig: lockdownConfigSchema.optional(),
    }),
  },
  includeDefaultCrud: true,
  navDescription: "Reusable step configurations for ramp schedules.",
  navAfterTag: "ramp-schedules",
} satisfies OpenApiModelSpec;
export default rampScheduleTemplateApiSpec;
