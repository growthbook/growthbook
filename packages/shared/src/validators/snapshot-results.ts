import { z } from "zod";

type ExperimentSnapshotResultColumnLengthMismatch = {
  column: string;
  actualLength: number;
  expectedLength: number;
};

type ExperimentSnapshotResultNumRowsMismatch = {
  actualLength: number;
  expectedLength: number;
};

function getExperimentSnapshotResultLengthMismatches({
  data,
  numRows,
}: {
  data: Record<string, unknown[]>;
  numRows: number;
}): {
  columnMismatches: ExperimentSnapshotResultColumnLengthMismatch[];
  numRowsMismatch?: ExperimentSnapshotResultNumRowsMismatch;
} {
  const columnMismatches: ExperimentSnapshotResultColumnLengthMismatch[] = [];
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

export function validateExperimentSnapshotResultChunkColumnLengths({
  data,
  numRows,
}: {
  data: Record<string, unknown[]>;
  numRows: number;
}) {
  const { columnMismatches, numRowsMismatch } =
    getExperimentSnapshotResultLengthMismatches({
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
    "Snapshot result chunk columns must have the same length and match numRows: " +
      messages.join("; "),
  );
}

export const experimentSnapshotResultChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    snapshotId: z.string(),
    resultChunkVersion: z.string().optional(),
    experimentId: z.string(),
    metricId: z.string(),
    numRows: z.number(),
    data: z.record(z.string(), z.array(z.unknown())),
  })
  .strict()
  .superRefine((chunk, ctx) => {
    const { columnMismatches, numRowsMismatch } =
      getExperimentSnapshotResultLengthMismatches(chunk);

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

export type ExperimentSnapshotResultChunkInterface = z.infer<
  typeof experimentSnapshotResultChunkValidator
>;
