// ─────────────────────────────────────────────────────────────────────────
// FIXTURE DATA: demo numbers for the experiments list's attention tiles.
// NOT REAL. For reviewing the tiles in a dev org without realistic data.
//
// To turn it off, set USE_ATTENTION_TILES_FIXTURE to false: the tiles go
// back to what they compute from the org's experiments
// (services/experimentListTiles). To remove it, delete this file and its
// one import in pages/experiments/index.tsx.
//
// Only the tiles' figures come from here. The table still lists the org's
// real experiments for the selected tile, so its rows won't match these
// counts.
// ─────────────────────────────────────────────────────────────────────────

export const USE_ATTENTION_TILES_FIXTURE = true;

export type AttentionTileFigures = {
  count: number;
  series?: number[];
  changePercent?: number | null;
};

// The change from a series' first value to its last, as a whole
// percentage: round((last - first) / first * 100). Null when there's no
// first value to compare with (fewer than two points, or a first value of
// 0), or no change, so no "0%" with a misleading arrow.
export function deltaFromSeries(series: number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (first === 0 || last === first) return null;
  return Math.round(((last - first) / first) * 100);
}

// A tile from its 7-day series alone, so its figures can't disagree: the
// count is the series' last value, the change runs first to last, and the
// sparkline plots the whole series.
function fromSeries(series: number[]): AttentionTileFigures {
  return {
    count: series[series.length - 1] ?? 0,
    series,
    changePercent: deltaFromSeries(series),
  };
}

export const ATTENTION_TILES_FIXTURE = {
  all: { count: 130 },
  // 9, +80%
  "needs-decision": fromSeries([5, 6, 6, 7, 6, 8, 9]),
  // 3, -40%
  unhealthy: fromSeries([5, 6, 5, 4, 4, 3, 3]),
  // 6, +100%
  "ending-soon": fromSeries([3, 4, 4, 5, 5, 5, 6]),
} satisfies Record<string, AttentionTileFigures>;
