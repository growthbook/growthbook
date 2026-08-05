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

// ---------------------------------------------------------------------------
// Holdout size
// ---------------------------------------------------------------------------

/**
 * Largest share of traffic that can be held out. The Holdout buckets an equal
 * control group alongside the held-out group, so anything above 0.5 would need
 * more than all available traffic.
 */
export const MAX_HOLDOUT_SIZE = 0.5;

/**
 * Converts the public `holdoutSize` to the stored phase `coverage`, and back.
 *
 * Both are exact in binary floating point (multiplying and dividing by two only
 * shifts the exponent), so a value round-trips through the API unchanged.
 */
export function holdoutSizeToCoverage(holdoutSize: number): number {
  return holdoutSize * 2;
}

export function coverageToHoldoutSize(coverage: number): number {
  return coverage / 2;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

/**
 * A Holdout's lifecycle stage. Not stored on the document — derived from the
 * holdout experiment's `status` plus the holdout's `analysisStartDate` by
 * `getHoldoutStage`. `analysis-period` is a running holdout that has entered
 * its measurement window.
 */
export const holdoutStage = [
  "draft",
  "running",
  "analysis-period",
  "stopped",
] as const;
export type HoldoutStage = (typeof holdoutStage)[number];
