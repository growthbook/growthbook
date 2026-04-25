import { z } from "zod";

type ExperimentSnapshotAnalysisChunkColumnLengthMismatch = {
  column: string;
  actualLength: number;
  expectedLength: number;
};

type ExperimentSnapshotAnalysisChunkNumRowsMismatch = {
  actualLength: number;
  expectedLength: number;
};

function getExperimentSnapshotAnalysisChunkLengthMismatches({
  data,
  numRows,
}: {
  data: Record<string, unknown[]>;
  numRows: number;
}): {
  columnMismatches: ExperimentSnapshotAnalysisChunkColumnLengthMismatch[];
  numRowsMismatch?: ExperimentSnapshotAnalysisChunkNumRowsMismatch;
} {
  const columnMismatches: ExperimentSnapshotAnalysisChunkColumnLengthMismatch[] =
    [];
  const expectedLength = Object.values(data)[0]?.length ?? 0;

  for (const [column, values] of Object.entries(data)) {
    if (values.length !== expectedLength) {
      columnMismatches.push({
        column,
        actualLength: values.length,
        expectedLength,
      });
    }
  }

  return {
    columnMismatches,
    numRowsMismatch:
      numRows === expectedLength
        ? undefined
        : {
            actualLength: numRows,
            expectedLength,
          },
  };
}

export function validateExperimentSnapshotAnalysisChunkColumnLengths({
  data,
  numRows,
}: {
  data: Record<string, unknown[]>;
  numRows: number;
}) {
  const { columnMismatches, numRowsMismatch } =
    getExperimentSnapshotAnalysisChunkLengthMismatches({
      data,
      numRows,
    });
  if (!columnMismatches.length && !numRowsMismatch) return;

  const messages = columnMismatches.map(
    ({ column, actualLength, expectedLength }) =>
      `${column} has ${actualLength}, expected ${expectedLength}`,
  );
  if (numRowsMismatch) {
    messages.push(
      `numRows has ${numRowsMismatch.actualLength}, expected ${numRowsMismatch.expectedLength}`,
    );
  }

  throw new Error(
    "Snapshot analysis chunk columns must have the same length and match numRows: " +
      messages.join("; "),
  );
}

export const experimentSnapshotAnalysisChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    snapshotId: z.string(),
    experimentId: z.string(),
    metricId: z.string(),
    numRows: z.number(),
    data: z.record(z.string(), z.array(z.unknown())),
  })
  .strict()
  .superRefine((chunk, ctx) => {
    const { columnMismatches, numRowsMismatch } =
      getExperimentSnapshotAnalysisChunkLengthMismatches(chunk);

    for (const mismatch of columnMismatches) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Column "${mismatch.column}" has ${mismatch.actualLength} rows, expected ${mismatch.expectedLength}`,
        path: ["data", mismatch.column],
      });
    }

    if (numRowsMismatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `numRows has ${numRowsMismatch.actualLength} rows, expected ${numRowsMismatch.expectedLength}`,
        path: ["numRows"],
      });
    }
  });

export type ExperimentSnapshotAnalysisChunkInterface = z.infer<
  typeof experimentSnapshotAnalysisChunkValidator
>;
