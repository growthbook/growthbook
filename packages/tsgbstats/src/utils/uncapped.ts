/**
 * Replace main metric columns with their uncapped versions.
 * Used for generating supplemental results with uncapped data.
 */
export function replaceWithUncapped(
  data: Record<string, unknown>[],
): Record<string, unknown>[] {
  // Deep copy the data
  const result = JSON.parse(JSON.stringify(data)) as Record<string, unknown>[];

  // Columns to replace
  const columnsToReplace = ["main_sum", "main_sum_squares"];

  for (const row of result) {
    for (const key of Object.keys(row)) {
      for (const col of columnsToReplace) {
        // Match patterns like "baseline_main_sum" or "v1_main_sum"
        if (key.endsWith(`_${col}`)) {
          const prefix = key.slice(0, -col.length - 1);
          const uncappedKey = `${prefix}_uncapped_${col}`;

          if (uncappedKey in row && row[uncappedKey] !== undefined) {
            row[key] = row[uncappedKey];
          }
        }
      }
    }
  }

  return result;
}
