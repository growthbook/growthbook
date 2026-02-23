import { z } from "zod";
import { featureEnvironment } from "./features";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.coerce.date(),
  id: z.string(),
});

const statusUpdateScheduleValidator = z.object({
  startAt: z.coerce.date().optional(),
  startAnalysisPeriodAt: z.coerce.date().optional(),
  stopAt: z.coerce.date().optional(),
});

const nextScheduledStatusUpdateValidator = z.object({
  type: z.enum(["start", "startAnalysisPeriod", "stop"]),
  date: z.coerce.date(),
});

export type HoldoutNextScheduledStatusUpdate = z.infer<
  typeof nextScheduledStatusUpdateValidator
>;

// const isoDatetimeToDate = z.codec(z.iso.datetime(), z.date(), {
//   decode: (isoString) => new Date(isoString),
//   encode: (date) => date.toISOString(),
// });

export const holdoutValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.coerce.date(),
    dateUpdated: z.coerce.date(),
    projects: z.array(z.string()),
    name: z.string(),
    experimentId: z.string(),
    linkedExperiments: z.record(z.string(), holdoutLinkedItemValidator),
    linkedFeatures: z.record(z.string(), holdoutLinkedItemValidator),
    environmentSettings: z.record(z.string(), featureEnvironment),
    analysisStartDate: z.coerce.date().optional(),
    // May be undefined for holdouts created before scheduling was added
    // Set to null when the schedule is deleted
    statusUpdateSchedule: statusUpdateScheduleValidator.optional().nullable(),
    // Set to null when the schedule is complete or deleted
    nextScheduledStatusUpdate: nextScheduledStatusUpdateValidator
      .optional()
      .nullable(),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
