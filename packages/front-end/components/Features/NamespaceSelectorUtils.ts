export type RangeTuple = [number, number];

export type NamespaceGap = {
  start: number;
  end: number;
};

export function clampRangeBoundary(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return min;
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}

export function subtractRangeFromGap(
  gap: NamespaceGap,
  range: RangeTuple,
): NamespaceGap[] {
  const [rangeStart, rangeEnd] = range;
  if (rangeEnd <= gap.start || rangeStart >= gap.end) {
    return [gap];
  }

  const next: NamespaceGap[] = [];
  if (rangeStart > gap.start) {
    next.push({ start: gap.start, end: rangeStart });
  }
  if (rangeEnd < gap.end) {
    next.push({ start: rangeEnd, end: gap.end });
  }
  return next;
}

export function subtractSelectedRangesFromGaps(
  gaps: NamespaceGap[],
  ranges: RangeTuple[],
): NamespaceGap[] {
  return ranges.reduce((remaining, range) => {
    return remaining.flatMap((gap) => subtractRangeFromGap(gap, range));
  }, gaps);
}

export function sortGapsBySizeThenStart(gaps: NamespaceGap[]): NamespaceGap[] {
  return [...gaps].sort((a, b) => {
    const gapDiff = b.end - b.start - (a.end - a.start);
    return gapDiff !== 0 ? gapDiff : a.start - b.start;
  });
}

export function getLargestGap(gaps: NamespaceGap[]): NamespaceGap | undefined {
  return sortGapsBySizeThenStart(gaps)[0];
}

export function rangeFallsWithinGap(gap: NamespaceGap, value: number): boolean {
  return value >= gap.start && value < gap.end;
}

export function findContainingGap(
  gaps: NamespaceGap[],
  value: number,
): NamespaceGap | undefined {
  return gaps.find((gap) => rangeFallsWithinGap(gap, value));
}

export function normalizeRangeAfterLowerChange(
  currentRange: RangeTuple,
  nextStartRaw: number,
  gaps: NamespaceGap[],
): RangeTuple {
  const [, currentEnd] = currentRange;

  if (!Number.isFinite(nextStartRaw) || nextStartRaw < 0 || nextStartRaw > 1) {
    return currentRange;
  }

  const containingGap = findContainingGap(gaps, nextStartRaw);
  if (!containingGap) {
    return currentRange;
  }

  const nextStart = nextStartRaw;
  const nextEnd =
    currentEnd > nextStart && currentEnd <= containingGap.end
      ? currentEnd
      : containingGap.end;

  if (nextEnd <= nextStart) {
    return currentRange;
  }

  return [nextStart, nextEnd];
}

export function normalizeRangeAfterUpperChange(
  currentRange: RangeTuple,
  nextEndRaw: number,
  gaps: NamespaceGap[],
): RangeTuple {
  const [start, currentEnd] = currentRange;
  const containingGap = findContainingGap(gaps, start);

  if (!containingGap) {
    return currentRange;
  }

  if (
    !Number.isFinite(nextEndRaw) ||
    nextEndRaw <= start ||
    nextEndRaw > containingGap.end
  ) {
    const fallbackEnd =
      currentEnd > start && currentEnd <= containingGap.end
        ? currentEnd
        : containingGap.end;

    return fallbackEnd > start ? [start, fallbackEnd] : currentRange;
  }

  return [start, nextEndRaw];
}

/**
 * Merge contiguous / overlapping ranges into a single range.
 *
 * Inputs like `[[0.6, 0.9], [0.9, 1]]` become `[[0.6, 1]]`. Ranges are sorted
 * by start before merging, and any degenerate ranges (end <= start) are
 * dropped so callers don't have to pre-filter. Field inputs snap to step 0.01
 * so exact numeric equality is adequate for detecting contiguity here.
 */
export function mergeContiguousRanges(ranges: RangeTuple[]): RangeTuple[] {
  if (ranges.length <= 1) {
    return ranges.filter(([start, end]) => end > start);
  }

  const sorted = ranges
    .filter(([start, end]) => end > start)
    .slice()
    .sort((a, b) => a[0] - b[0]);

  const merged: RangeTuple[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function shiftDraftKeysAfterRangeRemoval(
  drafts: Record<string, string>,
  removedIndex: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(drafts).flatMap(([key, value]) => {
      const [index, field] = key.split(":");
      const numericIndex = Number(index);

      if (Number.isNaN(numericIndex) || numericIndex === removedIndex) {
        return [];
      }

      const nextIndex =
        numericIndex > removedIndex ? numericIndex - 1 : numericIndex;

      return [[`${nextIndex}:${field}`, value]];
    }),
  );
}

export function trimDraftKeysToRangeLength(
  drafts: Record<string, string>,
  rangeLength: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(drafts).filter(([key]) => {
      const [index] = key.split(":");
      return Number(index) < rangeLength;
    }),
  );
}

export function computeInUseIntervals(
  gaps: { start: number; end: number }[],
): RangeTuple[] {
  const sorted = [...gaps].sort((a, b) => a.start - b.start);
  const result: RangeTuple[] = [];
  let cursor = 0;
  for (const g of sorted) {
    if (cursor < g.start) result.push([cursor, g.start]);
    cursor = Math.max(cursor, g.end);
  }
  if (cursor < 1) result.push([cursor, 1]);
  return result;
}

export function computeOverlapIntervals(
  selectedRanges: RangeTuple[],
  inUseIntervals: RangeTuple[],
): RangeTuple[] {
  const result: RangeTuple[] = [];
  for (const [rs, re] of selectedRanges) {
    for (const [is, ie] of inUseIntervals) {
      const start = Math.max(rs, is);
      const end = Math.min(re, ie);
      if (start < end) result.push([start, end]);
    }
  }
  return result;
}
