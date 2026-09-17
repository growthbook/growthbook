import { z } from "zod";

export const experimentDiagnosticsSummaryItemValidator = z.object({
  date: z.string(),
  variationId: z.string(),
  exposureCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
});

export type ExperimentDiagnosticsSummaryItem = z.infer<
  typeof experimentDiagnosticsSummaryItemValidator
>;

export const experimentDiagnosticsRecordValidator = z.object({
  timestamp: z.string(),
  userId: z.string().nullable(),
  variationId: z.string(),
  dimensions: z.record(z.string(), z.string().nullable()),
});

export type ExperimentDiagnosticsRecord = z.infer<
  typeof experimentDiagnosticsRecordValidator
>;

const breakdownEntry = z.object({
  variationId: z.string(),
  exposureCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
});

export const experimentDiagnosticsAggregatedSummaryValidator = z.object({
  totalExposures: z.number().int().nonnegative(),
  totalUsers: z.number().int().nonnegative(),
  variationBreakdown: z.array(breakdownEntry),
  dailyTrend: z.array(
    z.object({
      date: z.string(),
      exposureCount: z.number().int().nonnegative(),
    }),
  ),
  dimensionBreakdown: z
    .array(
      z.object({
        dimensionValue: z.string(),
        exposureCount: z.number().int().nonnegative(),
        userCount: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  variationDimensionBreakdown: z
    .array(breakdownEntry.extend({ dimensionValue: z.string() }))
    .optional(),
});

export type ExperimentDiagnosticsAggregatedSummary = z.infer<
  typeof experimentDiagnosticsAggregatedSummaryValidator
>;
