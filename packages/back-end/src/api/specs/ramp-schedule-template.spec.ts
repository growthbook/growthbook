import { z } from "zod";
import {
  apiRampScheduleTemplateValidator,
  apiTemplateRampStep,
  lockdownConfigSchema,
  rampMonitoringConfig,
  templateEndPatchValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// Experiment ramp templates carry the entity discriminator; feature templates
// omit it (entityType absent = feature).
const templateEntityType = z
  .enum(["feature", "experiment"])
  .optional()
  .describe(
    "Which entity kind the template targets. Omit for feature templates.",
  );

export const rampScheduleTemplateApiSpec = {
  modelSingular: "rampScheduleTemplate",
  modelPlural: "rampScheduleTemplates",
  pathBase: "/ramp-schedule-templates",
  apiInterface: apiRampScheduleTemplateValidator,
  schemas: {
    createBody: z.object({
      name: z.string(),
      entityType: templateEntityType,
      steps: z.array(apiTemplateRampStep),
      endPatch: templateEndPatchValidator.optional(),
      official: z.boolean().optional(),
      monitoringConfig: rampMonitoringConfig.nullish(),
      lockdownConfig: lockdownConfigSchema.optional(),
      order: z
        .number()
        .optional()
        .describe(
          "Display order within the org (lower sorts first). Omit to append to the end.",
        ),
    }),
    updateBody: z.object({
      name: z.string().optional(),
      // entityType is fixed at creation and cannot be changed.
      steps: z.array(apiTemplateRampStep).optional(),
      endPatch: templateEndPatchValidator.optional(),
      official: z.boolean().optional(),
      monitoringConfig: rampMonitoringConfig.nullish(),
      lockdownConfig: lockdownConfigSchema.optional(),
      order: z
        .number()
        .optional()
        .describe("Display order within the org (lower sorts first)."),
    }),
  },
  includeDefaultCrud: true,
  navDescription: "Reusable step configurations for ramp schedules.",
  navAfterTag: "ramp-schedules",
} satisfies OpenApiModelSpec;
export default rampScheduleTemplateApiSpec;
