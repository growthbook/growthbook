import { z } from "zod";
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
import {
  ExperimentMetricDefinition,
  getAdjustedCI,
  getMetricResultStatus,
  hasEnoughData,
  setAdjustedPValuesOnResults,
} from "./experiments";

export type AdjustmentEffectSize = "small" | "moderate" | "large";

// Structural, so front-end table rows and back-end snapshot results both fit.
export interface AdjustmentImpactRow {
  metric: ExperimentMetricDefinition;
  variations: SnapshotMetric[];
}

export type SupplementalField = keyof NonNullable<
  SnapshotMetric["supplementalResults"]
>;

export interface AdjustmentClassification {
  effectSize: AdjustmentEffectSize;
  /** Fraction of the lift, e.g. 0.042 = 4.2%. */
  relativeChange: number;
  /** Null when the adjustment is judged on the relative scale. */
  standardErrorShift: number | null;
  /** Reported only when the rule's trigger made the effect "large". */
  significanceChanged: boolean;
  /** Reported only when the rule's trigger made the effect "large". */
  signFlipped: boolean;
}

export interface AdjustmentImpact extends AdjustmentClassification {
  field: SupplementalField;
  label: string;
}

const shiftThresholdsSchema = z.object({
  moderate: z.number(),
  // Null when a shift alone is never "large".
  large: z.number().nullable(),
  largeWithTrigger: z.number(),
});

// "large" is the bar for alerting on a result.
const adjustmentRuleSchema = z.object({
  // Variance reduction and capping move the estimate by noise that scales with
  // the standard error, not the lift, so measuring them against the lift would
  // flag ordinary noise near zero. A prior shrinks the lift by a fraction.
  scale: z.enum(["standardError", "relative"]),
  thresholds: shiftThresholdsSchema,
  // What must accompany a `largeWithTrigger` shift. Status is
  // significant-positive, significant-negative or not significant; a
  // significant sign flip needs only one of the two results to be significant.
  largeTrigger: z.enum(["statusChange", "significantSignFlip"]),
});

// Keyed by the supplemental result each adjustment is compared against.
const adjustmentImpactSettingsSchema = z.object({
  unstratified: adjustmentRuleSchema,
  cupedUnadjusted: adjustmentRuleSchema,
  flatPrior: adjustmentRuleSchema,
  uncapped: adjustmentRuleSchema,
});

type ShiftThresholds = z.infer<typeof shiftThresholdsSchema>;
type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;
export type AdjustmentImpactSettings = z.infer<
  typeof adjustmentImpactSettingsSchema
>;

const RELATIVE_THRESHOLDS: ShiftThresholds = {
  moderate: 0.01,
  large: null,
  largeWithTrigger: 0.5,
};

// Same estimand with less noise, so a change in significance alone is the
// adjustment working.
const VARIANCE_REDUCTION_RULE: AdjustmentRule = {
  scale: "standardError",
  thresholds: { moderate: 0.5, large: 2, largeWithTrigger: 1 },
  largeTrigger: "significantSignFlip",
};

const CAPPING_RULE: AdjustmentRule = {
  scale: "standardError",
  thresholds: { moderate: 0.5, large: 2, largeWithTrigger: 0.5 },
  largeTrigger: "statusChange",
};

// Shrinks the estimate by design, so shrinkage alone is never large.
const PRIOR_RULE: AdjustmentRule = {
  scale: "relative",
  thresholds: RELATIVE_THRESHOLDS,
  largeTrigger: "statusChange",
};

export const DEFAULT_ADJUSTMENT_IMPACT_SETTINGS: AdjustmentImpactSettings = {
  unstratified: VARIANCE_REDUCTION_RULE,
  cupedUnadjusted: VARIANCE_REDUCTION_RULE,
  flatPrior: PRIOR_RULE,
  uncapped: CAPPING_RULE,
};

// For settings from a feature flag: anything malformed gets the defaults.
export function parseAdjustmentImpactSettings(
  value: unknown,
): AdjustmentImpactSettings {
  const parsed = adjustmentImpactSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ADJUSTMENT_IMPACT_SETTINGS;
}

const ADJUSTMENTS: {
  field: keyof AdjustmentImpactSettings;
  label: string;
}[] = [
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

function isMoreSevere(
  a: AdjustmentClassification,
  b: AdjustmentClassification,
): boolean {
  if (SEVERITY_RANK[a.effectSize] !== SEVERITY_RANK[b.effectSize]) {
    return SEVERITY_RANK[a.effectSize] > SEVERITY_RANK[b.effectSize];
  }
  return (
    (a.standardErrorShift ?? a.relativeChange) >
    (b.standardErrorShift ?? b.relativeChange)
  );
}

// Legacy lognormal results store the standard error on the log scale, not the
// scale of `expected`.
function getLiftStandardError(stats: SnapshotMetric): number | undefined {
  const stddev = stats.uplift?.stddev;
  if (stats.uplift?.dist !== "normal") return undefined;
  if (stddev === undefined || !Number.isFinite(stddev)) return undefined;
  return stddev;
}

function classifyPair({
  primaryLift,
  altLift,
  primaryStandardError,
  altStandardError,
  primarySignificant,
  altSignificant,
  compareSignificance = true,
  rule,
}: {
  primaryLift: number;
  altLift: number;
  primaryStandardError?: number;
  altStandardError?: number;
  primarySignificant: boolean;
  altSignificant: boolean;
  compareSignificance?: boolean;
  rule: AdjustmentRule;
}): AdjustmentClassification {
  const shift = Math.abs(primaryLift - altLift);

  const denominator = Math.max(Math.abs(primaryLift), Math.abs(altLift));
  const relativeChange = denominator === 0 ? 0 : shift / denominator;

  // The larger standard error, so that the shift is not overstated.
  const standardError = Math.max(
    primaryStandardError ?? 0,
    altStandardError ?? 0,
  );
  const standardErrorShift =
    rule.scale === "standardError" && standardError > 0
      ? shift / standardError
      : null;

  // A standard-error rule with no standard error falls back to the relative
  // scale, where its own thresholds do not apply.
  const thresholds =
    rule.scale === "standardError" && standardErrorShift === null
      ? RELATIVE_THRESHOLDS
      : rule.thresholds;
  const shiftSize = standardErrorShift ?? relativeChange;

  const rawSignFlip =
    Math.sign(primaryLift) !== Math.sign(altLift) &&
    primaryLift !== 0 &&
    altLift !== 0;
  // A sign flip between two non-significant results is noise around zero.
  const significantSignFlip =
    rawSignFlip &&
    (primarySignificant || (compareSignificance && altSignificant));
  const significanceDiffers =
    compareSignificance && primarySignificant !== altSignificant;
  const statusChanged = significanceDiffers || significantSignFlip;

  const triggered =
    (rule.largeTrigger === "statusChange"
      ? statusChanged
      : significantSignFlip) && shiftSize >= thresholds.largeWithTrigger;

  let effectSize: AdjustmentEffectSize;
  if (
    triggered ||
    (thresholds.large !== null && shiftSize >= thresholds.large)
  ) {
    effectSize = "large";
  } else if (shiftSize >= thresholds.moderate) {
    effectSize = "moderate";
  } else {
    effectSize = "small";
  }

  return {
    effectSize,
    relativeChange,
    standardErrorShift,
    significanceChanged: triggered && significanceDiffers,
    signFlipped: triggered && significantSignFlip,
  };
}

export function computeSupplementalAdjustedPValues({
  goalRows,
  field,
  pValueCorrection,
}: {
  goalRows: AdjustmentImpactRow[];
  field: SupplementalField;
  pValueCorrection: PValueCorrection;
}): Map<string, number> | null {
  if (!pValueCorrection) return null;

  const metricIds = goalRows.map((goalRow) => goalRow.metric.id);
  const variationCount = goalRows[0]?.variations.length ?? 0;
  if (variationCount === 0) return null;

  // A metric the adjustment does not apply to (e.g. an uncapped metric, for
  // capping) has no supplemental result and keeps its own p-value, since it is
  // the same either way.
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
      metrics[goalRow.metric.id] = {
        ...stats,
        pValue: supplementalPValue ?? stats.pValue,
        pValueAdjusted: undefined,
      };
    });
    variations.push({ users: 0, metrics });
  }

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
 * A row's results as they would be without one adjustment. The displayed
 * result's multiple-testing-corrected p-value and interval do not carry over:
 * they are recomputed, or cleared when they cannot be.
 */
export function getSupplementalVariations({
  row,
  field,
  statsEngine,
  pValueThreshold,
  goalRows,
  pValueCorrection,
}: {
  row: AdjustmentImpactRow;
  field: SupplementalField;
  statsEngine: StatsEngine;
  pValueThreshold: number;
  /** All non-slice goal rows, the family for adjusted p-values. */
  goalRows?: AdjustmentImpactRow[];
  pValueCorrection?: PValueCorrection;
}): SnapshotMetric[] {
  const adjustedPValues =
    statsEngine === "frequentist" && pValueCorrection && goalRows
      ? computeSupplementalAdjustedPValues({
          goalRows,
          field,
          pValueCorrection,
        })
      : null;

  return row.variations.map((stats, index) => {
    const supplemental = stats.supplementalResults?.[field];
    if (!supplemental) return stats;

    const result: SnapshotMetric = {
      ...stats,
      ...(supplemental as Partial<SnapshotMetric>),
      pValueAdjusted: undefined,
      ciAdjusted: undefined,
    };

    const pValueAdjusted = adjustedPValues?.get(`${row.metric.id}:${index}`);
    if (pValueAdjusted !== undefined) {
      result.pValueAdjusted = pValueAdjusted;
      // Mirrors setAdjustedCIs.
      if (result.uplift && result.ci) {
        result.ciAdjusted =
          getAdjustedCI(
            pValueAdjusted,
            result.uplift.mean,
            pValueThreshold,
            result.ci,
          ) ?? result.ci;
      }
    }
    return result;
  });
}

/**
 * The most affected of the displayed treatment variations. Null when no
 * variation can be compared: no supplemental result, an errored result, or a
 * metric short of its minimum sample size.
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
  settings = DEFAULT_ADJUSTMENT_IMPACT_SETTINGS,
}: {
  row: AdjustmentImpactRow;
  field: SupplementalField;
  baselineRow: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
  /** All non-slice goal rows, the family for adjusted p-values. */
  goalRows?: AdjustmentImpactRow[];
  pValueCorrection?: PValueCorrection;
  settings?: AdjustmentImpactSettings;
}): AdjustmentClassification | null {
  const baseline = row.variations[baselineRow];
  if (!baseline) return null;

  const rule =
    settings[field === "noVarianceReduction" ? "cupedUnadjusted" : field];

  const altVariations = getSupplementalVariations({
    row,
    field,
    statsEngine,
    pValueThreshold,
    goalRows,
    pValueCorrection,
  });

  const commonArgs = {
    metric: row.metric,
    metricDefaults,
    ciLower,
    ciUpper,
    pValueThreshold,
    statsEngine,
    differenceType,
  };

  let worst: AdjustmentClassification | null = null;

  row.variations.forEach((primaryStats, index) => {
    if (index === baselineRow) return;
    if (variationFilter?.includes(index)) return;
    if (!primaryStats.supplementalResults?.[field]) return;

    const altStats = altVariations[index];
    // An errored result reports a lift of zero, which would read as a shift.
    if (primaryStats.errorMessage || altStats.errorMessage) return;
    if (!hasEnoughData(baseline, primaryStats, row.metric, metricDefaults)) {
      return;
    }

    const { significant: primarySignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline,
      stats: primaryStats,
    });
    const { significant: altSignificant } = getMetricResultStatus({
      ...commonArgs,
      baseline: altVariations[baselineRow],
      stats: altStats,
    });

    const classification = classifyPair({
      primaryLift: primaryStats.expected ?? 0,
      altLift: altStats.expected ?? 0,
      primaryStandardError: getLiftStandardError(primaryStats),
      altStandardError: getLiftStandardError(altStats),
      primarySignificant,
      altSignificant,
      // A corrected result is not comparable with one whose correction could
      // not be recomputed.
      compareSignificance:
        primaryStats.pValueAdjusted === undefined ||
        altStats.pValueAdjusted !== undefined,
      rule,
    });

    if (!worst || isMoreSevere(classification, worst)) {
      worst = classification;
    }
  });

  return worst;
}

export function getAdjustmentImpactSummary(args: {
  row: AdjustmentImpactRow;
  baselineRow: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  pValueThreshold: number;
  /** All non-slice goal rows, the family for adjusted p-values. */
  goalRows?: AdjustmentImpactRow[];
  pValueCorrection?: PValueCorrection;
  settings?: AdjustmentImpactSettings;
}): AdjustmentImpact[] {
  const summary: AdjustmentImpact[] = [];
  ADJUSTMENTS.forEach(({ field, label }) => {
    const classification = classifyAdjustmentImpact({ ...args, field });
    if (classification !== null) {
      summary.push({ field, label, ...classification });
    }
  });

  // Most severe first. Ties break on relative change, which is comparable
  // across adjustments judged on different scales.
  return summary.sort((a, b) => {
    if (SEVERITY_RANK[a.effectSize] !== SEVERITY_RANK[b.effectSize]) {
      return SEVERITY_RANK[b.effectSize] - SEVERITY_RANK[a.effectSize];
    }
    return b.relativeChange - a.relativeChange;
  });
}
