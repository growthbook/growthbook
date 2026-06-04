// Day-grain bounds for the covariate read paths. Floor-snapping both window
// bounds to UTC day starts keeps the pre-aggregated read and the daily-aligned
// legacy fallback consistent (both cover the same whole days).

export function snapToUtcDayStart(date: Date): Date {
  const snapped = new Date(date);
  snapped.setUTCHours(0, 0, 0, 0);
  return snapped;
}

export function precedingUtcDayStart(date: Date): Date {
  const dayStart = snapToUtcDayStart(date);
  return new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
}
