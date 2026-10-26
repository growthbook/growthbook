import {
  getMetricResultStatus,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import {
  SnapshotMetric,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";
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

export type AdjustmentEffectSize = "small" | "moderate" | "large";

export type SupplementalField = keyof NonNullable<
  SnapshotMetric["supplementalResults"]
>;

export interface AdjustmentClassification {
  effectSize: AdjustmentEffectSize;
  /** Relative change in the lift estimate (fraction, e.g. 0.042 = 4.2%). */
  relativeChange: number;
  /** Statistical significance flipped between the primary and adjusted result. */
  significanceChanged: boolean;
  /** The sign of the lift estimate flipped. */
  signFlipped: boolean;
}

export interface AdjustmentImpact extends AdjustmentClassification {
  field: SupplementalField;
  label: string;
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
  small: 0,
  moderate: 1,
  large: 2,
};

/**
 * Returns true when `a` should be surfaced ahead of `b`: higher severity, or
 * equal severity with a larger relative change in the estimate.
 */
function isMoreSevere(
  a: AdjustmentClassification,
  b: AdjustmentClassification,
): boolean {
  if (SEVERITY_RANK[a.effectSize] !== SEVERITY_RANK[b.effectSize]) {
    return SEVERITY_RANK[a.effectSize] > SEVERITY_RANK[b.effectSize];
  }
  return a.relativeChange > b.relativeChange;
}

function classifyPair({
  primaryLift,
  altLift,
  primarySignificant,
  altSignificant,
  compareSignificance = true,
}: {
  primaryLift: number;
  altLift: number;
  primarySignificant: boolean;
  altSignificant: boolean;
  compareSignificance?: boolean;
}): AdjustmentClassification {
  const significanceChanged =
    compareSignificance && primarySignificant !== altSignificant;

  const denominator = Math.max(Math.abs(primaryLift), Math.abs(altLift));
  const relativeChange =
    denominator === 0 ? 0 : Math.abs(primaryLift - altLift) / denominator;
  const signFlipped =
    Math.sign(primaryLift) !== Math.sign(altLift) &&
    primaryLift !== 0 &&
    altLift !== 0;

  let effectSize: AdjustmentEffectSize;
  if (
    significanceChanged ||
    signFlipped ||
    relativeChange >= LARGE_EFFECT_THRESHOLD
  ) {
    effectSize = "large";
  } else if (relativeChange >= MODERATE_EFFECT_THRESHOLD) {
    effectSize = "moderate";
  } else {
    effectSize = "small";
  }

  return { effectSize, relativeChange, significanceChanged, signFlipped };
}

export function computeSupplementalAdjustedPValues({
  goalRows,
  field,
  pValueCorrection,
}: {
  goalRows: ExperimentTableRow[];
  field: SupplementalField;
  pValueCorrection: PValueCorrection;
}): Map<string, number> | null {
  if (!pValueCorrection) return null;

  const metricIds = goalRows.map((goalRow) => goalRow.metric.id);
  const variationCount = goalRows[0]?.variations.length ?? 0;
  if (variationCount === 0) return null;

  let missingCoverage = false;

  // Rebuild a single-dimension result whose goal-metric p-values are the field's
  // unadjusted values.
  const variations: SnapshotVariation[] = [];
  for (
    let variationIndex = 0;
    variationIndex < variationCount;
    variationIndex++
  ) {
    const metrics: Record<string, SnapshotMetric> = {};
    goalRows.forEach((goalRow) => {
      const stats = goalRow.variations[variationIndex];
      if (stats?.pValue === undefined) return; // not part of the family
      const supplementalPValue = (
        stats.supplementalResults?.[field] as { pValue?: number } | undefined
      )?.pValue;
      if (supplementalPValue === undefined) {
        // A family member lacks this adjustment's supplemental result, so we
        // cannot build a comparable family — signal fallback.
        missingCoverage = true;
        return;
      }
      metrics[goalRow.metric.id] = {
        ...stats,
        pValue: supplementalPValue,
        pValueAdjusted: undefined,
      };
    });
    variations.push({ users: 0, metrics });
  }

  if (missingCoverage) return null;

  const results: ExperimentReportResultDimension[] = [
    { name: "", srm: 0, variations },
  ];
  setAdjustedPValuesOnResults(results, metricIds, pValueCorrection);

  const map = new Map<string, number>();
  results[0].variations.forEach((variation, variationIndex) => {
    metricIds.forEach((metricId) => {
      const adjusted = variation.metrics[metricId]?.pValueAdjusted;
      if (adjusted !== undefined) {
        map.set(`${metricId}:${variationIndex}`, adjusted);
      }
    });
  });

  return map.size > 0 ? map : null;
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
  goalRows,
  pValueCorrection,
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
  /** All non-slice goal rows, used to recompute family-wide adjusted p-values. */
  goalRows?: ExperimentTableRow[];
  pValueCorrection?: PValueCorrection;
}): AdjustmentClassification | null {
  const baseline = row.variations[baselineRow];
  if (!baseline) return null;

  const altAdjustedPValues =
    statsEngine === "frequentist" && pValueCorrection && goalRows
      ? computeSupplementalAdjustedPValues({
          goalRows,
          field,
          pValueCorrection,
        })
      : null;

  let worst: AdjustmentClassification | null = null;

  row.variations.forEach((primaryStats, index) => {
    if (index === baselineRow) return;
    if (variationFilter?.includes(index)) return;

    const supplemental = primaryStats.supplementalResults?.[field];
    if (!supplemental) return;

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

    const altAdjusted = altAdjustedPValues?.get(`${row.metric.id}:${index}`);

    // Is the displayed primary result's significance driven by a
    // multiple-testing-corrected p-value.
    const primaryIsCorrected = primaryStats.pValueAdjusted !== undefined;

    let primaryForSignificance: SnapshotMetric;
    let altForSignificance: SnapshotMetric;
    let compareSignificance = true;
    if (altAdjusted !== undefined) {
      // Adjusted-vs-adjusted: both sides use family-wide corrected p-values.
      primaryForSignificance = primaryStats;
      altForSignificance = { ...altStats, pValueAdjusted: altAdjusted };
    } else if (primaryIsCorrected) {
      // The displayed result is corrected, but we could not recompute the
      // counterfactual's family-wide adjusted p-value.
      primaryForSignificance = primaryStats;
      altForSignificance = altStats;
      compareSignificance = false;
    } else {
      // No multiple-testing correction on the displayed result; the raw
      // p-values are the displayed basis, so compare them directly.
      primaryForSignificance = { ...primaryStats, pValueAdjusted: undefined };
      altForSignificance = { ...altStats, pValueAdjusted: undefined };
    }

    const { significant: primarySignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline,
      stats: primaryForSignificance,
    });
    const { significant: altSignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline: altBaseline,
      stats: altForSignificance,
    });

    const classification = classifyPair({
      primaryLift: primaryStats.expected ?? 0,
      altLift: altStats.expected ?? 0,
      primarySignificant,
      altSignificant,
      compareSignificance,
    });

    if (!worst || isMoreSevere(classification, worst)) {
      worst = classification;
    }
  });

  return worst;
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
  /** All non-slice goal rows, used to recompute family-wide adjusted p-values. */
  goalRows?: ExperimentTableRow[];
  pValueCorrection?: PValueCorrection;
}): AdjustmentImpact[] {
  const summary: AdjustmentImpact[] = [];
  ADJUSTMENTS.forEach(({ field, label }) => {
    const classification = classifyAdjustmentImpact({ ...args, field });
    if (classification !== null) {
      summary.push({ field, label, ...classification });
    }
  });

  // Surface the most impactful adjustments first (large -> moderate -> small).
  // Ties break by the larger relative change in the estimate; equal changes
  // preserve the order defined in ADJUSTMENTS (stable sort).
  return summary.sort((a, b) => {
    if (SEVERITY_RANK[a.effectSize] !== SEVERITY_RANK[b.effectSize]) {
      return SEVERITY_RANK[b.effectSize] - SEVERITY_RANK[a.effectSize];
    }
    return b.relativeChange - a.relativeChange;
  });
}
