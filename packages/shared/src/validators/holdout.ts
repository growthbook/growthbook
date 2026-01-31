import { z } from "zod";
import { featureEnvironment } from "./features";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
});

const scheduledUpdatesValidator = z.object({
  startAt: z.date().optional(),
  startAnalysisPeriodAt: z.date().optional(),
  stopAt: z.date().optional(),
});

export type HoldoutUpdateSchedule = z.infer<typeof scheduledUpdatesValidator>;

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
    scheduledStatusUpdates: scheduledUpdatesValidator.optional(),
    nextScheduledUpdate: z.date().optional().nullable(),
    nextScheduledUpdateType: z
      .enum(["start", "startAnalysisPeriod", "stop"])
      .optional()
      .nullable(),
  })
  .strict();

const _holdoutStringDatesValidator = holdoutValidator
  .omit({
    dateCreated: true,
    dateUpdated: true,
    analysisStartDate: true,
    scheduledStatusUpdates: true,
    nextScheduledUpdate: true,
    linkedExperiments: true,
    linkedFeatures: true,
  })
  .extend({
    dateCreated: z.string(),
    dateUpdated: z.string(),
    analysisStartDate: z.string().optional(),
    scheduledStatusUpdates: z
      .object({
        startAt: z.string().optional(),
        startAnalysisPeriodAt: z.string().optional(),
        stopAt: z.string().optional(),
      })
      .optional(),
    nextScheduledUpdate: z.string().optional().nullable(),
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
