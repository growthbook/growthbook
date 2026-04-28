import { z } from "zod";

const ANALYSIS_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export const analysisKeySchema = z
  .string()
  .min(5, "analysisKey must be at least 5 characters long")
  .regex(
    ANALYSIS_KEY_PATTERN,
    "analysisKey must contain only alphanumerics, dashes, or underscores",
  );

type ExperimentSnapshotAnalysisChunkColumnLengthMismatch = {
  analysisKey: string;
  column: string;
  actualLength: number;
  expectedLength: number;
};

type ExperimentSnapshotAnalysisChunkNumRowsMismatch = {
  analysisKey: string;
  actualLength: number;
  expectedLength: number;
};

function getPerAnalysisChunkLengthMismatches(
  analysisKey: string,
  perAnalysis: { numRows: number } & Record<string, unknown>,
): {
  columnMismatches: ExperimentSnapshotAnalysisChunkColumnLengthMismatch[];
  numRowsMismatch?: ExperimentSnapshotAnalysisChunkNumRowsMismatch;
} {
  const columnEntries: Array<[string, unknown[]]> = [];
  for (const [key, value] of Object.entries(perAnalysis)) {
    if (key === "numRows") continue;
    if (Array.isArray(value)) {
      columnEntries.push([key, value]);
    }
  }

  // If every column agrees on a single length, that length is authoritative
  // and `numRows` is validated against it. Otherwise fall back to `numRows`
  // as the expected length for per-column error messages.
  const firstLength = columnEntries[0]?.[1]?.length ?? 0;
  const columnsAgree = columnEntries.every(
    ([, values]) => values.length === firstLength,
  );
  const expectedLength = columnsAgree ? firstLength : perAnalysis.numRows;

  const columnMismatches: ExperimentSnapshotAnalysisChunkColumnLengthMismatch[] =
    [];
  for (const [column, values] of columnEntries) {
    if (values.length !== expectedLength) {
      columnMismatches.push({
        analysisKey,
        column,
        actualLength: values.length,
        expectedLength,
      });
    }
  }

  return {
    columnMismatches,
    numRowsMismatch:
      perAnalysis.numRows === expectedLength
        ? undefined
        : {
            analysisKey,
            actualLength: perAnalysis.numRows,
            expectedLength,
          },
  };
}

/**
 * Runtime assertion used by the encoder to catch column-length mismatches
 * before persistence. Throws with a combined message covering every
 * analysis sub-path in the chunk.
 */
export function validateExperimentSnapshotAnalysisChunkColumnLengths({
  data,
}: {
  data: Record<string, { numRows: number } & Record<string, unknown>>;
}) {
  const messages: string[] = [];

  for (const [analysisKey, perAnalysis] of Object.entries(data)) {
    const { columnMismatches, numRowsMismatch } =
      getPerAnalysisChunkLengthMismatches(analysisKey, perAnalysis);

    for (const mismatch of columnMismatches) {
      messages.push(
        `data.${analysisKey}.${mismatch.column} has ${mismatch.actualLength}, expected ${mismatch.expectedLength}`,
      );
    }
    if (numRowsMismatch) {
      messages.push(
        `data.${analysisKey}.numRows has ${numRowsMismatch.actualLength}, expected ${numRowsMismatch.expectedLength}`,
      );
    }
  }

  if (!messages.length) return;

  throw new Error(
    "Snapshot analysis chunk columns must have the same length and match numRows: " +
      messages.join("; "),
  );
}

// One analysis's rows, stored as parallel columnar arrays under
// `data[<analysisKey>]` inside a chunk document. `d` (dimension name) and
// `v` (variation index) are required index columns. Any additional keys
// are value columns sourced from `SnapshotMetric`.
//
// `catchall(z.unknown())` instead of `z.array(z.unknown())` so the inferred
// TypeScript type doesn't intersect `numRows: number` with `unknown[]` (=
// `never`). The superRefine below filters via `Array.isArray`, and the
// write-path `validateExperimentSnapshotAnalysisChunkColumnLengths` helper
// enforces column-array shape before persistence.
const perAnalysisChunkSchema = z
  .object({
    numRows: z.number().int().nonnegative(),
    d: z.array(z.unknown()),
    v: z.array(z.unknown()),
  })
  .catchall(z.unknown());

export const experimentSnapshotAnalysisChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    snapshotId: z.string(),
    experimentId: z.string(),
    metricId: z.string(),
    data: z.record(analysisKeySchema, perAnalysisChunkSchema),
  })
  .strict()
  .superRefine((chunk, ctx) => {
    for (const [analysisKey, perAnalysis] of Object.entries(chunk.data)) {
      const { columnMismatches, numRowsMismatch } =
        getPerAnalysisChunkLengthMismatches(analysisKey, perAnalysis);

      for (const mismatch of columnMismatches) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Column "${mismatch.column}" in analysis "${analysisKey}" has ${mismatch.actualLength} rows, expected ${mismatch.expectedLength}`,
          path: ["data", analysisKey, mismatch.column],
        });
      }

      if (numRowsMismatch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `numRows for analysis "${analysisKey}" has ${numRowsMismatch.actualLength} rows, expected ${numRowsMismatch.expectedLength}`,
          path: ["data", analysisKey, "numRows"],
        });
      }
    }
  });

export type ExperimentSnapshotAnalysisChunkInterface = z.infer<
  typeof experimentSnapshotAnalysisChunkValidator
>;
