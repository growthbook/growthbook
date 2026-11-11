/** A resolved time window, as the ISO strings a request was sent with. */
export interface ResolvedWindow {
  startDate: string;
  endDate: string;
}

export function windowIsWithinLoaded(
  candidate: ResolvedWindow,
  loaded: ResolvedWindow,
  options: { allowStaleEnd?: boolean } = {},
): boolean {
  const start = Date.parse(candidate.startDate);
  const end = Date.parse(candidate.endDate);
  const loadedStart = Date.parse(loaded.startDate);
  const loadedEnd = Date.parse(loaded.endDate);
  if (isNaN(start) || isNaN(end) || isNaN(loadedStart) || isNaN(loadedEnd)) {
    return false;
  }
  return (
    start >= loadedStart &&
    start < loadedEnd &&
    end >= start &&
    (options.allowStaleEnd || end <= loadedEnd)
  );
}

export function rowsWithinWindow<T>(
  rows: T[],
  window: ResolvedWindow,
  getTimestamp: (row: T) => string | null | undefined,
): T[] {
  const start = Date.parse(window.startDate);
  const end = Date.parse(window.endDate);
  if (isNaN(start) || isNaN(end)) return rows;
  return rows.filter((row) => {
    const raw = getTimestamp(row);
    if (!raw) return true;
    const at = Date.parse(raw);
    if (isNaN(at)) return true;
    return at >= start && at <= end;
  });
}
