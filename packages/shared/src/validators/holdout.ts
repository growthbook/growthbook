import { z } from "zod";
import { statsEngines, MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { MAX_HOLDOUT_SIZE } from "../util/holdouts";
import { featureEnvironment } from "./features";
import { savedGroupTargeting } from "./shared";
import { optionalOwnerInputField } from "./owner-field";

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
