import { getMetricResultStatus } from "shared/experiments";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";
import { ExperimentTableRow } from "@/services/experiments";

export function filterRowsForMetricDrilldown(
  rows: ExperimentTableRow[],
  metricId: string,
  searchTerm?: string,
): {
  mainRow: ExperimentTableRow | undefined;
  sliceRows: ExperimentTableRow[];
  filteredSliceRows: ExperimentTableRow[];
} {
  const mainRow = rows.find((r) => !r.isSliceRow && r.metric.id === metricId);

  const sliceRows = rows.filter(
    (row) => row.isSliceRow && row.metric.id === metricId,
  );

  let filteredSliceRows = sliceRows;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredSliceRows = sliceRows.filter((row) => {
      const sliceName =
        typeof row.label === "string" ? row.label : row.metric.name;
      return sliceName.toLowerCase().includes(term);
    });
  }

  return { mainRow, sliceRows, filteredSliceRows };
}

/**
 * Adjustment-impact summary
 * ------------------------------------------------------------------
 * Classifies how much each analysis adjustment (post-stratification,
 * CUPED, Bayesian prior, capping) moves the result relative to the
 * primary/active analysis.
 */

export type AdjustmentEffectSize = "little" | "moderate" | "large";

export type SupplementalField = keyof NonNullable<
  SnapshotMetric["supplementalResults"]
>;

export interface AdjustmentImpact {
  field: SupplementalField;
  label: string;
  effectSize: AdjustmentEffectSize;
}

const MODERATE_EFFECT_THRESHOLD = 0.01; // 1%
const LARGE_EFFECT_THRESHOLD = 0.1; // 10%

const ADJUSTMENTS: { field: SupplementalField; label: string }[] = [
  { field: "unstratified", label: "Post-stratification" },
  { field: "cupedUnadjusted", label: "CUPED" },
  { field: "flatPrior", label: "Bayesian prior" },
  { field: "uncapped", label: "Capping" },
];

const SEVERITY_RANK: Record<AdjustmentEffectSize, number> = {
  little: 0,
  moderate: 1,
  large: 2,
};

function maxSeverity(
  a: AdjustmentEffectSize,
  b: AdjustmentEffectSize,
): AdjustmentEffectSize {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function classifyPair({
  primaryLift,
  altLift,
  primarySignificant,
  altSignificant,
}: {
  primaryLift: number;
  altLift: number;
  primarySignificant: boolean;
  altSignificant: boolean;
}): AdjustmentEffectSize {
  // A change in statistical significance is always material.
  if (primarySignificant !== altSignificant) return "large";

  const denominator = Math.max(Math.abs(primaryLift), Math.abs(altLift));
  // Both estimates are effectively zero: rely on the significance check above.
  if (denominator === 0) return "little";

  const relativeChange = Math.abs(primaryLift - altLift) / denominator;
  const signFlipped =
    Math.sign(primaryLift) !== Math.sign(altLift) &&
    primaryLift !== 0 &&
    altLift !== 0;

  if (signFlipped || relativeChange >= LARGE_EFFECT_THRESHOLD) return "large";
  if (relativeChange >= MODERATE_EFFECT_THRESHOLD) return "moderate";
  return "little";
}

/**
 * Classify a single adjustment's impact across the displayed treatment
 * variations. Returns null when the supplemental data required for the
 * comparison is not present for any variation (so the row is omitted).
 */
export function classifyAdjustmentImpact({
  row,
  field,
  baselineRow,
  variationFilter,
  metricDefaults,
  statsEngine,
  differenceType,
  ciUpper,
  ciLower,
  pValueThreshold,
}: {
  row: ExperimentTableRow;
  field: SupplementalField;
  baselineRow: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
}): AdjustmentEffectSize | null {
  const baseline = row.variations[baselineRow];
  if (!baseline) return null;

  let hasComparison = false;
  let worst: AdjustmentEffectSize = "little";

  row.variations.forEach((primaryStats, index) => {
    if (index === baselineRow) return;
    if (variationFilter?.includes(index)) return;

    const supplemental = primaryStats.supplementalResults?.[field];
    if (!supplemental) return;

    hasComparison = true;

    // Overlay the supplemental result on both the variation and the
    // baseline, mirroring how the detailed comparison tables are built.
    const altStats: SnapshotMetric = {
      ...primaryStats,
      ...(supplemental as Partial<SnapshotMetric>),
    };
    const baselineSupplemental = baseline.supplementalResults?.[field];
    const altBaseline: SnapshotMetric = baselineSupplemental
      ? { ...baseline, ...(baselineSupplemental as Partial<SnapshotMetric>) }
      : baseline;

    const commonArgs = {
      metric: row.metric,
      metricDefaults,
      ciLower,
      ciUpper,
      pValueThreshold,
      statsEngine,
      differenceType,
    };

    const { significant: primarySignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline,
      stats: primaryStats,
    });
    const { significant: altSignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline: altBaseline,
      stats: altStats,
    });

    worst = maxSeverity(
      worst,
      classifyPair({
        primaryLift: primaryStats.expected ?? 0,
        altLift: altStats.expected ?? 0,
        primarySignificant,
        altSignificant,
      }),
    );
  });

  return hasComparison ? worst : null;
}

/**
 * Build the adjustment-impact summary for a metric row. Only adjustments
 * with the supplemental data needed for a comparison are included.
 */
export function getAdjustmentImpactSummary(args: {
  row: ExperimentTableRow;
  baselineRow: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
}): AdjustmentImpact[] {
  const summary: AdjustmentImpact[] = [];
  ADJUSTMENTS.forEach(({ field, label }) => {
    const effectSize = classifyAdjustmentImpact({ ...args, field });
    if (effectSize !== null) {
      summary.push({ field, label, effectSize });
    }
  });

  // Surface the most impactful adjustments first (large -> small -> none).
  // Ties preserve the order defined in ADJUSTMENTS (stable sort).
  return summary.sort(
    (a, b) => SEVERITY_RANK[b.effectSize] - SEVERITY_RANK[a.effectSize],
  );
}
