import { z } from "zod";
import { statsEngines, MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { MAX_HOLDOUT_SIZE, holdoutStage } from "../util/holdouts";
import { apiBaseSchema } from "./base-model";
import { featureEnvironment } from "./features";
import { namedSchema } from "./openapi-helpers";
import {
  optionalOwnerInputField,
  ownerEmailField,
  ownerField,
  ownerInputField,
} from "./owner-field";
import { booleanQueryField, savedGroupTargeting } from "./shared";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
});

const statusUpdateScheduleValidator = z.object({
  startAt: z.date().optional(),
  startAnalysisPeriodAt: z.date().optional(),
  stopAt: z.date().optional(),
});

const nextScheduledStatusUpdateValidator = z.object({
  type: z.enum(["start", "startAnalysisPeriod", "stop"]),
  date: z.date(),
});

export type HoldoutNextScheduledStatusUpdate = z.infer<
  typeof nextScheduledStatusUpdateValidator
>;

export const holdoutValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    projects: z.array(z.string()),
    name: z.string(),
    skipAsDefaultHoldout: z.boolean().optional(),
    experimentId: z.string(),
    linkedExperiments: z.record(z.string(), holdoutLinkedItemValidator),
    linkedFeatures: z.record(z.string(), holdoutLinkedItemValidator),
    environmentSettings: z.record(z.string(), featureEnvironment),
    analysisStartDate: z.date().optional(),
    // May be undefined for holdouts created before scheduling was added
    // Set to null when the schedule is deleted
    statusUpdateSchedule: statusUpdateScheduleValidator.optional().nullable(),
    // Set to null when the schedule is complete or deleted
    nextScheduledStatusUpdate: nextScheduledStatusUpdateValidator
      .optional()
      .nullable(),
  })
  .strict();

const _holdoutStringDatesValidator = holdoutValidator
  .omit({
    dateCreated: true,
    dateUpdated: true,
    analysisStartDate: true,
    statusUpdateSchedule: true,
    nextScheduledStatusUpdate: true,
    linkedExperiments: true,
    linkedFeatures: true,
  })
  .extend({
    dateCreated: z.string(),
    dateUpdated: z.string(),
    analysisStartDate: z.string().optional(),
    statusUpdateSchedule: z
      .object({
        startAt: z.string().optional(),
        startAnalysisPeriodAt: z.string().optional(),
        stopAt: z.string().optional(),
      })
      .optional(),
    nextScheduledStatusUpdate: z
      .object({
        type: z.enum(["start", "startAnalysisPeriod", "stop"]),
        date: z.string(),
      })
      .optional()
      .nullable(),
    linkedExperiments: z.record(
      z.string(),
      holdoutLinkedItemValidator
        .omit({ dateAdded: true })
        .extend({ dateAdded: z.string() }),
    ),
    linkedFeatures: z.record(
      z.string(),
      holdoutLinkedItemValidator
        .omit({ dateAdded: true })
        .extend({ dateAdded: z.string() }),
    ),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
export type HoldoutInterfaceStringDates = z.infer<
  typeof _holdoutStringDatesValidator
>;

export const createHoldoutInputValidator = z.object({
  name: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z.array(z.string()).optional(),
  owner: optionalOwnerInputField,
  tags: z.array(z.string()).optional(),
  skipAsDefaultHoldout: z.boolean().optional(),

  hashAttribute: z.string().optional(),
  holdoutSize: z.number().min(0).max(MAX_HOLDOUT_SIZE).optional(),
  targetingCondition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),

  datasourceId: z.string().optional(),
  assignmentQueryId: z.string().optional(),
  goalMetrics: z.array(z.string()).optional(),
  secondaryMetrics: z.array(z.string()).optional(),

  environmentSettings: z.record(z.string(), featureEnvironment).optional(),
  statsEngine: z.enum(statsEngines).optional(),
  customFields: z.record(z.string(), z.any()).optional(),
});

export type CreateHoldoutInput = z.infer<typeof createHoldoutInputValidator>;

// ---------------------------------------------------------------------------
// API validators
// ---------------------------------------------------------------------------

const apiHoldoutVariation = z.object({
  variationId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
});

const apiHoldoutEnvironment = z.object({
  enabled: z
    .boolean()
    .describe("Whether the Holdout is active in this environment."),
});

const apiHoldoutLinkedItem = z.object({
  id: z.string(),
  dateAdded: z.iso.datetime(),
});

/**
 * The share of traffic held out, as a proportion.
 *
 * Stored internally as the experiment phase's `coverage`, which is twice this
 * value: a `holdoutSize` of 0.05 corresponds to a `coverage` of 0.1.
 */
const holdoutSizeField = z
  .number()
  .min(0)
  .max(MAX_HOLDOUT_SIZE)
  .describe(
    "Proportion of traffic held out, expressed as a decimal (e.g. 0.05 for 5%). An equally-sized control group is bucketed alongside it, so the Holdout occupies twice this share of traffic in total. Maximum 0.5.",
  );

const apiHoldoutStatusUpdateSchedule = z
  .object({
    startAt: z.iso
      .datetime()
      .describe(
        "ISO datetime to move the Holdout from `draft` to `running`. Must be in the future while the Holdout is still a draft.",
      )
      .optional(),
    startAnalysisPeriodAt: z.iso
      .datetime()
      .describe(
        "ISO datetime to move the Holdout from `running` to `analysis-period`. Requires `startAt` while the Holdout is still a draft.",
      )
      .optional(),
    stopAt: z.iso
      .datetime()
      .describe(
        "ISO datetime to stop the Holdout. Requires `startAnalysisPeriodAt` unless the analysis period has already begun.",
      )
      .optional(),
  })
  .describe(
    "Automatic stage transitions for the Holdout. Dates must be consecutive: `startAt` before `startAnalysisPeriodAt` before `stopAt`. Send `null` to delete the schedule.",
  );

/**
 * Read shape for a Holdout. A Holdout is stored as two documents — the holdout
 * itself and a companion experiment of type `holdout` — and this schema merges
 * both so callers never have to know which half a field lives on.
 */
export const apiHoldoutValidator = namedSchema(
  "Holdout",
  apiBaseSchema.safeExtend({
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    projects: z
      .array(z.string())
      .describe(
        "Project IDs this Holdout applies to. An empty array means All Projects.",
      ),
    owner: ownerField,
    ownerEmail: ownerEmailField,
    tags: z.array(z.string()),
    archived: z.boolean(),
    stage: z
      .enum(holdoutStage)
      .describe(
        "Lifecycle stage of the Holdout. Use the start, start-analysis, and stop endpoints to move through the lifecycle.",
      ),
    trackingKey: z.string(),
    skipAsDefaultHoldout: z
      .boolean()
      .describe(
        "When true, this Holdout is not pre-selected for new Feature Flags and experiments in its Projects.",
      ),

    // Targeting and sizing
    holdoutSize: holdoutSizeField,
    hashAttribute: z
      .string()
      .describe("Attribute used to assign users to the Holdout."),
    targetingCondition: z
      .string()
      .describe("Targeting condition as a JSON string."),
    savedGroupTargeting: z.array(savedGroupTargeting).optional(),

    // Analysis settings
    datasourceId: z.string(),
    assignmentQueryId: z.string(),
    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    variations: z.array(apiHoldoutVariation),

    environments: z
      .record(z.string(), apiHoldoutEnvironment)
      .describe(
        "Per-environment state, keyed by environment ID. Environments not present are disabled.",
      ),

    linkedFeatures: z
      .array(apiHoldoutLinkedItem)
      .describe(
        "Feature Flags held out by this Holdout. Manage these through the Feature Flag endpoints.",
      ),
    linkedExperiments: z
      .array(apiHoldoutLinkedItem)
      .describe(
        "Experiments held out by this Holdout. Manage these through the experiment endpoints.",
      ),

    dateStarted: z.iso.datetime().optional(),
    analysisStartDate: z.iso
      .datetime()
      .describe("When the Holdout entered its analysis period.")
      .optional(),
    dateStopped: z.iso.datetime().optional(),

    statusUpdateSchedule: apiHoldoutStatusUpdateSchedule.nullable().optional(),
    nextScheduledStatusUpdate: z
      .object({
        type: z.enum(["start", "startAnalysisPeriod", "stop"]),
        date: z.iso.datetime(),
      })
      .describe("The next stage transition that will run automatically.")
      .nullable()
      .optional(),
  }),
);

export type ApiHoldoutInterface = z.infer<typeof apiHoldoutValidator>;

export const apiListHoldoutsValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({
    projectId: z.string().optional(),
    datasourceId: z.string().optional(),
    stage: z.enum(holdoutStage).optional(),
    archived: booleanQueryField.describe(
      "Filter by archived state. Omit to return both archived and unarchived Holdouts.",
    ),
  }),
  paramsSchema: z.never(),
};

export const apiCreateHoldoutBody = z.strictObject({
  name: z.string().min(1, "Holdout name cannot be empty"),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z
    .array(z.string())
    .describe(
      "Project IDs this Holdout applies to. Omit or send an empty array for All Projects.",
    )
    .optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),
  skipAsDefaultHoldout: z.boolean().optional(),

  holdoutSize: holdoutSizeField
    .describe(
      "Proportion of traffic held out, expressed as a decimal (e.g. 0.05 for 5%). An equally-sized control group is bucketed alongside it. Defaults to 0.05. Maximum 0.5.",
    )
    .optional(),
  hashAttribute: z.string().optional(),
  targetingCondition: z
    .string()
    .describe("Targeting condition as a JSON string.")
    .optional(),
  savedGroupTargeting: z.array(savedGroupTargeting).optional(),

  datasourceId: z.string().optional(),
  assignmentQueryId: z.string().optional(),
  goalMetrics: z.array(z.string()).optional(),
  secondaryMetrics: z.array(z.string()).optional(),
  statsEngine: z
    .enum(statsEngines)
    .describe("Statistics engine used to analyze this Holdout.")
    .optional(),

  environments: z
    .record(z.string(), apiHoldoutEnvironment)
    .describe(
      "Per-environment state, keyed by environment ID. Environments not listed are disabled.",
    )
    .optional(),

  statusUpdateSchedule: apiHoldoutStatusUpdateSchedule.optional(),
});

export type ApiCreateHoldoutBody = z.infer<typeof apiCreateHoldoutBody>;

export const apiUpdateHoldoutBody = z.strictObject({
  name: z.string().min(1, "Holdout name cannot be empty").optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z.array(z.string()).optional(),
  owner: ownerInputField.optional(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
  skipAsDefaultHoldout: z.boolean().optional(),

  holdoutSize: holdoutSizeField.optional(),
  hashAttribute: z.string().optional(),
  targetingCondition: z.string().optional(),
  savedGroupTargeting: z.array(savedGroupTargeting).optional(),

  datasourceId: z.string().optional(),
  assignmentQueryId: z.string().optional(),
  goalMetrics: z.array(z.string()).optional(),
  secondaryMetrics: z.array(z.string()).optional(),
  statsEngine: z
    .enum(statsEngines)
    .describe("Statistics engine used to analyze this Holdout.")
    .optional(),

  environments: z
    .record(z.string(), apiHoldoutEnvironment)
    .describe(
      "Replaces the entire per-environment state. Environments not listed are disabled.",
    )
    .optional(),

  statusUpdateSchedule: apiHoldoutStatusUpdateSchedule.nullable().optional(),
});

export type ApiUpdateHoldoutBody = z.infer<typeof apiUpdateHoldoutBody>;

/**
 * Update fields stored on the holdout document itself. `name` is deliberately
 * absent — it lives on both documents and is mirrored explicitly.
 */
export const HOLDOUT_API_UPDATE_FIELDS = [
  "projects",
  "skipAsDefaultHoldout",
] as const satisfies readonly (keyof ApiUpdateHoldoutBody)[];

/** Update fields stored on the companion experiment document. */
export const HOLDOUT_API_EXPERIMENT_UPDATE_FIELDS = [
  "description",
  "owner",
  "tags",
  "archived",
  "goalMetrics",
  "secondaryMetrics",
  "statsEngine",
] as const satisfies readonly (keyof ApiUpdateHoldoutBody)[];

/**
 * Update fields applied to the holdout experiment's current phase. These follow
 * the same path as the internal targeting endpoint rather than a plain update,
 * so the SDK payload and phase history stay correct.
 */
export const HOLDOUT_API_TARGETING_UPDATE_FIELDS = [
  "holdoutSize",
  "hashAttribute",
  "targetingCondition",
  "savedGroupTargeting",
] as const satisfies readonly (keyof ApiUpdateHoldoutBody)[];

export const apiHoldoutActionValidator = {
  paramsSchema: z.strictObject({ id: z.string() }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiHoldoutActionReturn = z.object({
  holdout: apiHoldoutValidator,
});
