import { z } from "zod";

/**
 * Status of the shadow comparison.
 */
export const statsShadowComparisonStatusValidator = z.enum([
  "match",
  "mismatch",
  "ts_error",
]);

/**
 * Python result with timing information.
 */
export const statsShadowPythonResultValidator = z
  .object({
    results: z.unknown(), // MultipleExperimentMetricAnalysis[] - stored as JSON
    durationMs: z.number(),
  })
  .strict();

/**
 * TypeScript result with timing information.
 */
export const statsShadowTsResultValidator = z
  .object({
    results: z.unknown(), // MultipleExperimentMetricAnalysis[] - stored as JSON
    durationMs: z.number(),
  })
  .strict();

/**
 * TypeScript error information.
 */
export const statsShadowTsErrorValidator = z
  .object({
    message: z.string(),
    stack: z.string().optional(),
  })
  .strict();

/**
 * Diff information for mismatches.
 */
export const statsShadowDiffValidator = z
  .object({
    summary: z.string(),
    pythonJson: z.string(),
    tsJson: z.string(),
  })
  .strict();

/**
 * Full StatsShadowComparison schema.
 */
export const statsShadowComparisonValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    // Context
    experimentId: z.string(),
    snapshotId: z.string().optional(),

    // Input (stored as JSON for debugging)
    input: z.unknown(), // ExperimentDataForStatsEngine[] - stored as JSON

    // Results
    pythonResult: statsShadowPythonResultValidator,
    tsResult: statsShadowTsResultValidator.optional(),

    // Error case
    tsError: statsShadowTsErrorValidator.optional(),

    // Comparison
    status: statsShadowComparisonStatusValidator,
    diff: statsShadowDiffValidator.optional(),
  })
  .strict();

export type StatsShadowComparisonStatus = z.infer<
  typeof statsShadowComparisonStatusValidator
>;
export type StatsShadowComparison = z.infer<
  typeof statsShadowComparisonValidator
>;
