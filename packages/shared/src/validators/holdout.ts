import { z } from "zod";
import { baseSchema } from "./base-model";
import { featureEnvironment } from "./features";
import { isoDatetimeToDate } from "./codecs";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: isoDatetimeToDate,
  id: z.string(),
});

const statusUpdateScheduleValidator = z.object({
  startAt: isoDatetimeToDate.optional(),
  startAnalysisPeriodAt: isoDatetimeToDate.optional(),
  stopAt: isoDatetimeToDate.optional(),
});

const nextScheduledStatusUpdateValidator = z.object({
  type: z.enum(["start", "startAnalysisPeriod", "stop"]),
  date: isoDatetimeToDate,
});

export type HoldoutNextScheduledStatusUpdate = z.infer<
  typeof nextScheduledStatusUpdateValidator
>;

const holdout = z
  .object({
    projects: z.array(z.string()),
    name: z.string(),
    experimentId: z.string(),
    linkedExperiments: z.record(z.string(), holdoutLinkedItemValidator),
    linkedFeatures: z.record(z.string(), holdoutLinkedItemValidator),
    environmentSettings: z.record(z.string(), featureEnvironment),
    analysisStartDate: isoDatetimeToDate.optional(),
    // May be undefined for holdouts created before scheduling was added
    // Set to null when the schedule is deleted
    statusUpdateSchedule: statusUpdateScheduleValidator.optional().nullable(),
    // Set to null when the schedule is complete or deleted
    nextScheduledStatusUpdate: nextScheduledStatusUpdateValidator
      .optional()
      .nullable(),
  })
  .strict();

export const holdoutValidator = baseSchema.extend(holdout.shape).strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
