import { parseWarehouseDate } from "shared/dates";

export interface ChartAnnotation {
  date: string; // A calendar day, YYYY-MM-DD
  text: string;
}

// Which of the chart's time buckets each note belongs on; notes outside the chart's range are dropped.
export function placeChartAnnotations(
  annotations: ChartAnnotation[],
  buckets: string[],
): { bucket: string; text: string }[] {
  // Parsed the way the chart parses them, so a note cannot shift with the viewer's time zone.
  const starts = buckets.map((b) => parseWarehouseDate(b).getTime());
  if (!starts.length) return [];
  // The last bucket is assumed to be as long as the one before it (a day when there is only one).
  const width =
    starts.length > 1
      ? starts[starts.length - 1] - starts[starts.length - 2]
      : 24 * 60 * 60 * 1000;
  const end = starts[starts.length - 1] + width;

  return annotations.flatMap((a) => {
    const at = parseWarehouseDate(a.date).getTime();
    if (Number.isNaN(at) || at < starts[0] || at >= end) return [];
    let i = starts.length - 1;
    while (starts[i] > at) i--;
    return [{ bucket: buckets[i], text: a.text }];
  });
}
