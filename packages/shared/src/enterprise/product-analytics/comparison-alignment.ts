import subYears from "date-fns/subYears";
import type { ProductAnalyticsResultRow } from "shared/validators";

function compareDateStringsAsc(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/** UTC calendar day `yyyy-MM-dd` for explorer dimension strings (ISO, etc.). */
export function explorerDimensionDateToUtcYyyyMmDd(key: string): string | null {
  const d = new Date(key);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Maps each current-period primary-dimension key to the comparison-period key
 * used for overlay / table pairing: YoY calendar match when present, else
 * chronological rank within the two windows.
 */
export function createComparisonAlignmentResolver(
  sortedXValues: string[],
  comparisonXValues: readonly string[],
  firstDimensionIsDate: boolean,
): (currentKey: string) => string | undefined {
  if (!firstDimensionIsDate) {
    return (currentKey) => currentKey;
  }
  const comparisonNormToOriginal = new Map<string, string>();
  for (const k of comparisonXValues) {
    const norm = explorerDimensionDateToUtcYyyyMmDd(k);
    if (norm && !comparisonNormToOriginal.has(norm)) {
      comparisonNormToOriginal.set(norm, k);
    }
  }

  const chronoCurrent = [...new Set(sortedXValues)].sort(compareDateStringsAsc);
  const chronoComp = [...new Set(comparisonXValues)].sort(
    compareDateStringsAsc,
  );
  const rankByCurrentX = new Map<string, number>();
  chronoCurrent.forEach((x, i) => {
    rankByCurrentX.set(x, i);
  });
  return (currentKey: string) => {
    const currentNorm = explorerDimensionDateToUtcYyyyMmDd(currentKey);
    if (currentNorm) {
      const shiftedNorm = subYears(new Date(`${currentNorm}T00:00:00.000Z`), 1)
        .toISOString()
        .slice(0, 10);
      const calendarMatch = comparisonNormToOriginal.get(shiftedNorm);
      if (calendarMatch !== undefined) {
        return calendarMatch;
      }
    }
    const rank = rankByCurrentX.get(currentKey);
    if (rank === undefined) return undefined;
    return chronoComp[rank];
  };
}

/**
 * Returns a lookup from current `dimensions[0]` to the aligned comparison row,
 * using the same rules as the explorer chart overlay.
 */
export function buildAlignedComparisonRowLookup(
  primaryRows: ProductAnalyticsResultRow[],
  comparisonRows: ProductAnalyticsResultRow[],
  firstDimensionIsDate: boolean,
): (currentDim0: string) => ProductAnalyticsResultRow | null {
  if (!firstDimensionIsDate) {
    const byKey = new Map<string, ProductAnalyticsResultRow>();
    for (const r of comparisonRows) {
      byKey.set(String(r.dimensions[0] ?? ""), r);
    }
    return (currentDim0) => byKey.get(currentDim0) ?? null;
  }

  const primaryKeys = primaryRows.map((r) => String(r.dimensions[0] ?? ""));
  const sortedXValues = [...new Set(primaryKeys)].sort(compareDateStringsAsc);
  const comparisonXValues = comparisonRows.map((r) =>
    String(r.dimensions[0] ?? ""),
  );
  const resolver = createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    true,
  );
  const rowByExactCompDim = new Map<string, ProductAnalyticsResultRow>();
  for (const r of comparisonRows) {
    const k = String(r.dimensions[0] ?? "");
    if (!rowByExactCompDim.has(k)) {
      rowByExactCompDim.set(k, r);
    }
  }
  return (currentDim0) => {
    const aligned = resolver(currentDim0);
    if (aligned === undefined) return null;
    return rowByExactCompDim.get(aligned) ?? null;
  };
}
