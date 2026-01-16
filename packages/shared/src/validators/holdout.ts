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

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
