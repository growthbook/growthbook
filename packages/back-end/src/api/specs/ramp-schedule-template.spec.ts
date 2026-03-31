import { z } from "zod";
import { apiRampScheduleTemplateValidator } from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

const rampStepActionSchema = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: z.object({
    ruleId: z.string(),
    coverage: z.number().min(0).max(1).optional(),
    condition: z.string().optional(),
  }),
});

const rampStepSchema = z.object({
  trigger: z.union([
    z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
    z.object({ type: z.literal("approval") }),
    z.object({
      type: z.literal("scheduled"),
      at: z.string().datetime(),
    }),
  ]),
  actions: z.array(rampStepActionSchema),
  approvalNotes: z.string().optional(),
});

const startConditionSchema = z.object({
  trigger: z.union([
    z.object({ type: z.literal("immediately") }),
    z.object({ type: z.literal("manual") }),
    z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
  ]),
  actions: z.array(rampStepActionSchema).optional(),
});

const endConditionSchema = z
  .object({
    trigger: z
      .object({ type: z.literal("scheduled"), at: z.string().datetime() })
      .optional(),
    actions: z.array(rampStepActionSchema).optional(),
    endEarlyWhenStepsComplete: z.boolean().optional(),
  })
  .optional()
  .nullable();

export const rampScheduleTemplateApiSpec = {
  modelSingular: "rampScheduleTemplate",
  modelPlural: "rampScheduleTemplates",
  pathBase: "/ramp-schedule-templates",
  apiInterface: apiRampScheduleTemplateValidator,
  schemas: {
    createBody: z.object({
      name: z.string(),
      steps: z.array(rampStepSchema),
      startCondition: startConditionSchema,
      disableRuleBefore: z.boolean().optional(),
      disableRuleAfter: z.boolean().optional(),
      endCondition: endConditionSchema,
      official: z.boolean().optional(),
    }),
    updateBody: z.object({
      name: z.string().optional(),
      steps: z.array(rampStepSchema).optional(),
      startCondition: startConditionSchema.optional(),
      disableRuleBefore: z.boolean().optional(),
      disableRuleAfter: z.boolean().optional(),
      endCondition: endConditionSchema,
      official: z.boolean().optional(),
    }),
  },
  includeDefaultCrud: true,
} satisfies OpenApiModelSpec;
export default rampScheduleTemplateApiSpec;
