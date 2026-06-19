import { z } from "zod";
import {
  apiRampScheduleTemplateValidator,
  apiTemplateRampStep,
  autoRollbackMode,
  lockdownConfigSchema,
  rampMonitoringConfig,
  rampProgressionMode,
  templateEndPatchValidator,
  templateShippingCriteria,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// Experiment ramp templates carry the entity discriminator + automation
// defaults; feature templates omit them (entityType absent = feature).
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
      // Experiment-template only; applied to the experiment when the template
      // is used. Rejected on feature templates.
      autoRollbackMode: autoRollbackMode.optional(),
      rampProgressionMode: rampProgressionMode.optional(),
      shippingCriteria: templateShippingCriteria.optional(),
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
      autoRollbackMode: autoRollbackMode.optional(),
      rampProgressionMode: rampProgressionMode.optional(),
      shippingCriteria: templateShippingCriteria.optional(),
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
