function fieldValue(row: Record<string, unknown>, column: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, column)) return row[column];
  const key = Object.keys(row).find(
    (key) => key.toLowerCase() === column.toLowerCase(),
  );
  return key ? row[key] : null;
}

export function getSampleChart(
  rows: Record<string, unknown>[],
  valueColumn: string,
  timestampColumn: string,
) {
  const numeric = !!valueColumn && !valueColumn.startsWith("$$");
  const counts = new Map<string, number>();
  let sampleSize = 0;
  for (const row of rows) {
    const value = fieldValue(row, numeric ? valueColumn : timestampColumn);
    let label: string;
    if (numeric) {
      if (typeof value !== "number" && typeof value !== "string") continue;
      if (typeof value === "string" && !value.trim()) continue;
      const number = Number(value);
      if (!Number.isFinite(number)) continue;
      label = String(number);
    } else {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value))
        continue;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) continue;
      label = date.toISOString().slice(0, 10);
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
    sampleSize++;
  }
  if (!sampleSize) return null;
  const labels = [...counts.keys()].sort(
    numeric ? (a, b) => Number(a) - Number(b) : undefined,
  );
  if (numeric && labels.length > 1) {
    const min = Number(labels[0]);
    const max = Number(labels[labels.length - 1]);
    const binCount = Math.min(10, Math.ceil(Math.sqrt(sampleSize)));
    const width = (max - min) / binCount;
    const bins = Array<number>(binCount).fill(0);
    for (const [label, count] of counts) {
      const index = Math.min(
        binCount - 1,
        Math.floor((Number(label) - min) / width),
      );
      bins[index] += count;
    }
    const format = (value: number) => String(Number(value.toPrecision(4)));
    return {
      numeric,
      sampleSize,
      labels: [...bins.keys()].map(
        (index) =>
          `${format(min + index * width)}–${format(min + (index + 1) * width)}`,
      ),
      counts: bins,
    };
  }
  return {
    numeric,
    sampleSize,
    labels,
    counts: labels.map((label) => counts.get(label) ?? 0),
  };
}
