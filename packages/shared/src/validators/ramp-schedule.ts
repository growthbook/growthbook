import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";

// Patch applied to a feature rule by a ramp step. Only fields present in the patch are applied;
// absent fields are inherited from the previous step's accumulated state.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).nullish(),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  force: z.any().optional(), // any JSON-serializable value
  // system-managed: injected as enabled:true when the ramp fires
  enabled: z.boolean().nullish(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

export const rampStepAction = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

// activatingRevisionVersion: set when ramp is created alongside a rule change; cleared on publish.
export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().nullish(),
  environment: z.string().nullish(),
  status: z.enum(["pending-join", "active"]),
  activatingRevisionVersion: z.number().int().nullish(),
});
export type RampTarget = z.infer<typeof rampTarget>;

export const rampEndTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampEndTrigger = z.infer<typeof rampEndTrigger>;

export const rampTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampTrigger = z.infer<typeof rampTrigger>;

// Sparse patch per step — only fields present are applied; absent fields accumulate from previous steps.
export const rampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampScheduleStatusArray = [
  "pending",
  "ready",
  "running",
  "paused",
  "pending-approval",
  "completed",
  "rolled-back",
] as const;
export type RampScheduleStatus = (typeof rampScheduleStatusArray)[number];

export const rampScheduleValidator = baseSchema
  .extend({
    name: z.string(),
    // Controls permissions and approval settings for the schedule.
    entityType: z.enum(["feature"]), // TODO v2: add "experiment"
    entityId: z.string(),
    targets: z.array(rampTarget),
    steps: z.array(rampStep),
    // Actions applied when the ramp completes (on top of all accumulated step patches).
    // Represents the final desired state of the rule after ramp completion.
    endActions: z.array(rampStepAction).optional(),
    // When set, the rule is kept disabled until this date, then Step 1 is applied.
    // null/absent means the ramp starts immediately when the activating revision is published.
    startDate: z.date().nullish(),
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
      })
      .nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    phaseStartedAt: z.date().nullish(), // interval timing anchor; resets after approval gates
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    nextProcessAt: z.date().nullish(), // next time the job should process this schedule; null = no polling needed
    elapsedMs: z.number().int().nullish(), // computed at response time; never stored
  })
  .superRefine((data, ctx) => {
    if (data.steps.length === 0 && !data.startDate && !data.endCondition?.trigger) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A ramp schedule with no steps must have a startDate or an end condition trigger.",
        path: ["steps"],
      });
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;

// Patch fields that are portable across features and can be stored in a template.
// Excludes `force` (feature-type-specific) and `enabled`/`ruleId` (system-injected).
export const TEMPLATE_PATCH_FIELDS = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
] as const;
export type TemplatePatchField = (typeof TEMPLATE_PATCH_FIELDS)[number];

// Top-level behavioral keys of a template (excludes metadata: id, name, org, dates).
// Start/end timing is not stored in templates; endPatch (final coverage/effects) is.
export const TEMPLATE_STRUCTURAL_KEYS = ["steps", "endPatch"] as const;
export type TemplateStructuralKey = (typeof TEMPLATE_STRUCTURAL_KEYS)[number];

// Template patches never store force — it is feature-type-specific and not portable.
const templateFeatureRulePatch = featureRulePatch.omit({ force: true });
const templateRampStepAction = rampStepAction.extend({
  patch: templateFeatureRulePatch,
});
const templateRampStep = rampStep.extend({
  actions: z.array(templateRampStepAction),
});

// End patch stored in a template: the final coverage/effects applied when the ramp completes.
// No ruleId (template has no targets), no force (feature-type-specific), no enabled (system-managed).
export const templateEndPatchValidator = z.object({
  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
});
export type TemplateEndPatch = z.infer<typeof templateEndPatchValidator>;

// Template: defines intermediate steps and final end patch (no start/end timing).
export const rampScheduleTemplateValidator = baseSchema.extend({
  name: z.string(),
  steps: z.array(templateRampStep),
  endPatch: templateEndPatchValidator.optional(),
  official: z.boolean().optional(),
});
export type RampScheduleTemplateInterface = z.infer<
  typeof rampScheduleTemplateValidator
>;

// API-facing step schema — identical to the DB variant except scheduled trigger uses
// an ISO string instead of a Date object (the API serializes dates as strings).
const apiRampTrigger = z.union([
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.string() }),
]);

// Template step action for the API — same as the DB variant (no date fields in actions).
export const apiTemplateRampStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(templateRampStepAction),
  approvalNotes: z.string().nullish(),
});
export type ApiTemplateRampStep = z.infer<typeof apiTemplateRampStep>;

// API-facing variant — uses ISO strings for dates (for OpenApiModelSpec compatibility).
export const apiRampScheduleTemplateValidator = apiBaseSchema.extend({
  name: z.string(),
  steps: z.array(apiTemplateRampStep),
  endPatch: templateEndPatchValidator.optional(),
  official: z.boolean().optional(),
});

// Minimal type for pending/draft ramp schedules before full data is available.
export type RampScheduleForDisplay = Partial<RampScheduleInterface> & {
  id: string;
  status: RampScheduleInterface["status"];
  name: string;
  targets: RampScheduleInterface["targets"];
  steps: RampScheduleInterface["steps"];
  startDate?: RampScheduleInterface["startDate"];
  dateCreated: Date;
  dateUpdated: Date;
};
