import { z } from "zod";
import { featureEnvironment } from "./features";

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
