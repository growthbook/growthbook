import type { UserJourneyPathRow } from "shared/validators";

export function pathRowsToTableData(rows: UserJourneyPathRow[]): {
  orderedColumnKeys: string[];
  rowData: Record<string, unknown>[];
} {
  if (!rows.length) {
    return {
      orderedColumnKeys: ["Step 1", "Step 2", "Unit count"],
      rowData: [],
    };
  }

  const maxSteps = Math.max(...rows.map((r) => r.steps?.length ?? 0), 2);
  const stepKeys = Array.from({ length: maxSteps }, (_, i) => `Step ${i + 1}`);
  const hasAvgSecs = rows.some(
    (r) =>
      r.avg_secs_between_steps?.length && r.avg_secs_between_steps.length > 0,
  );
  const maxGaps = hasAvgSecs
    ? Math.max(...rows.map((r) => r.avg_secs_between_steps?.length ?? 0), 1)
    : 0;
  const avgSecsKeys = Array.from(
    { length: maxGaps },
    (_, i) => `Avg secs ${i + 1}→${i + 2}`,
  );

  const orderedColumnKeys = [
    ...stepKeys,
    "Unit count",
    ...(hasAvgSecs ? avgSecsKeys : []),
  ];

  const rowData: Record<string, unknown>[] = rows.map((row) => {
    const record: Record<string, unknown> = {};
    stepKeys.forEach((key, i) => {
      record[key] = row.steps?.[i] ?? "";
    });
    record["Unit count"] =
      row.unit_count != null ? row.unit_count.toLocaleString() : "";
    if (hasAvgSecs) {
      avgSecsKeys.forEach((key, i) => {
        const val = row.avg_secs_between_steps?.[i];
        record[key] = val != null ? Number(val.toFixed(1)) : "";
      });
    }
    return record;
  });

  return { orderedColumnKeys, rowData };
}
