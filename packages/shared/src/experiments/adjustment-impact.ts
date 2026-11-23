import { z } from "zod";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";
import {
  ExperimentMetricDefinition,
  getMetricResultStatus,
  hasEnoughData,
} from "./experiments";
import { restoreOpenAdjustedCI } from "./results/enrich";

export type AdjustmentEffectSize = "small" | "moderate" | "large";

// One metric's result for each variation. Structural, so a front-end table
// row fits as it is.
export interface MetricResults {
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

export interface AdjustmentImpactArgs {
  statsEngine: StatsEngine;
  pValueThreshold: number;
  baselineIndex: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  settings?: AdjustmentImpactSettings;
}

// A bar for how far a result moves without an adjustment. Every part that is
// given must be met. Strict, so that a misspelt part fails to parse rather
// than being dropped, which would lower the bar.
const shiftConditionSchema = z
  .strictObject({
    // The shift in standard errors of the lift. Variance reduction and capping
    // move the estimate by noise that scales with the standard error, so
    // measuring them against the lift alone would flag noise near zero.
    standardErrors: z.number().optional(),
    // The shift as a fraction of the lift.
    relativeChange: z.number().optional(),
    // Status is significant-positive, significant-negative or not
    // significant; a significant sign flip needs only one of the two results
    // to be significant.
    requires: z.enum(["statusChange", "significantSignFlip"]).optional(),
  })
  // An empty condition would always be met.
  .refine((condition) => Object.keys(condition).length > 0);

// Meeting any one condition in a list is enough. Lists rather than single
// conditions because a Config override replaces a list whole but merges an
// object key by key, which would blend an override with the default.
const adjustmentRuleSchema = z.object({
  moderate: z.array(shiftConditionSchema),
  // The bar for alerting on a result.
  large: z.array(shiftConditionSchema),
});

// Keyed by the supplemental result each adjustment is compared against.
const adjustmentImpactSettingsSchema = z.object({
  unstratified: adjustmentRuleSchema,
  cupedUnadjusted: adjustmentRuleSchema,
  flatPrior: adjustmentRuleSchema,
  uncapped: adjustmentRuleSchema,
});

type ShiftCondition = z.infer<typeof shiftConditionSchema>;
type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;
export type AdjustmentImpactSettings = z.infer<
  typeof adjustmentImpactSettingsSchema
>;

const RELATIVE_MODERATE = 0.1;
const RELATIVE_LARGE = 0.5;

// Same estimand with less noise, so a change in significance alone is the
// adjustment working: only a sign flip counts.
const VARIANCE_REDUCTION_RULE: AdjustmentRule = {
  moderate: [{ standardErrors: 0.5 }],
  large: [
    // Also half the lift, so that a strongly significant result is not
    // flagged for a move that leaves it strongly significant.
    { standardErrors: 2, relativeChange: RELATIVE_LARGE },
    { standardErrors: 1, requires: "significantSignFlip" },
  ],
};

const CAPPING_RULE: AdjustmentRule = {
  moderate: [{ standardErrors: 0.5 }],
  large: [
    { standardErrors: 2, relativeChange: RELATIVE_LARGE },
    { standardErrors: 0.5, requires: "statusChange" },
  ],
};

// Shrinks the estimate by design, so shrinkage alone is never large.
const PRIOR_RULE: AdjustmentRule = {
  moderate: [{ relativeChange: RELATIVE_MODERATE }],
  large: [{ relativeChange: RELATIVE_LARGE, requires: "statusChange" }],
};

// A rule in standard errors cannot be applied to a result that has none, so
// the shift is judged against the lift, where a shift alone is never large.
function withoutStandardErrors(rule: AdjustmentRule): AdjustmentRule {
  return {
    moderate: [{ relativeChange: RELATIVE_MODERATE }],
    large: rule.large.flatMap(({ requires }) =>
      requires ? [{ relativeChange: RELATIVE_LARGE, requires }] : [],
    ),
  };
}

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

// Most severe first. Ties break on relative change, which every result has
// and which is comparable across adjustments judged on different scales.
function bySeverity(
  a: AdjustmentClassification,
  b: AdjustmentClassification,
): number {
  return (
    SEVERITY_RANK[b.effectSize] - SEVERITY_RANK[a.effectSize] ||
    b.relativeChange - a.relativeChange
  );
}

// Legacy lognormal results store the standard error on the log scale, not the
// scale of `expected`.
function getLiftStandardError(stats: SnapshotMetric): number {
  const stddev = stats.uplift?.stddev;
  if (stats.uplift?.dist !== "normal") return 0;
  return stddev !== undefined && Number.isFinite(stddev) ? stddev : 0;
}

function classifyPair({
  adjusted,
  unadjusted,
  adjustedSignificant,
  unadjustedSignificant,
  rule,
}: {
  adjusted: SnapshotMetric;
  unadjusted: SnapshotMetric;
  adjustedSignificant: boolean;
  unadjustedSignificant: boolean;
  rule: AdjustmentRule;
}): AdjustmentClassification {
  const adjustedLift = adjusted.expected ?? 0;
  const unadjustedLift = unadjusted.expected ?? 0;
  const shift = Math.abs(adjustedLift - unadjustedLift);
  const largerLift = Math.max(Math.abs(adjustedLift), Math.abs(unadjustedLift));
  const relativeChange = largerLift === 0 ? 0 : shift / largerLift;

  // The larger standard error, so that the shift is not overstated.
  const standardError = Math.max(
    getLiftStandardError(adjusted),
    getLiftStandardError(unadjusted),
  );
  const usesStandardErrors = [...rule.moderate, ...rule.large].some(
    (condition) => condition.standardErrors !== undefined,
  );
  const standardErrorShift =
    usesStandardErrors && standardError > 0 ? shift / standardError : null;
  const { moderate, large } =
    usesStandardErrors && standardErrorShift === null
      ? withoutStandardErrors(rule)
      : rule;

  // A corrected result is not comparable with one whose correction could not
  // be recomputed.
  const comparable =
    adjusted.pValueAdjusted === undefined ||
    unadjusted.pValueAdjusted !== undefined;
  // A sign flip between two non-significant results is noise around zero.
  const significantSignFlip =
    Math.sign(adjustedLift) * Math.sign(unadjustedLift) < 0 &&
    (adjustedSignificant || (comparable && unadjustedSignificant));
  const significanceDiffers =
    comparable && adjustedSignificant !== unadjustedSignificant;

  const isMet = (condition: ShiftCondition): boolean =>
    (condition.standardErrors === undefined ||
      (standardErrorShift !== null &&
        standardErrorShift >= condition.standardErrors)) &&
    (condition.relativeChange === undefined ||
      relativeChange >= condition.relativeChange) &&
    (condition.requires === undefined ||
      significantSignFlip ||
      (condition.requires === "statusChange" && significanceDiffers));

  const largeMet = large.filter(isMet);
  const triggered = largeMet.some(({ requires }) => requires !== undefined);

  return {
    effectSize:
      largeMet.length > 0
        ? "large"
        : moderate.some(isMet)
          ? "moderate"
          : "small",
    relativeChange,
    standardErrorShift,
    significanceChanged: triggered && significanceDiffers,
    signFlipped: triggered && significantSignFlip,
  };
}

/**
 * A metric's variations with each result replaced by its supplemental result:
 * the same test with one adjustment (e.g. CUPED) turned off.
 *
 * The corrected p-value and interval always come from the supplemental result,
 * even when it has none. The displayed result's correction was computed from
 * different p-values, so it must not be shown with the supplemental numbers.
 */
export function getVariationForSupplementalResult({
  metricResults,
  field,
}: {
  metricResults: MetricResults;
  field: SupplementalField;
}): SnapshotMetric[] {
  return metricResults.variations.map((stats) => {
    const supplemental = stats.supplementalResults?.[field];
    if (!supplemental) return stats;

    return restoreOpenAdjustedCI({
      ...stats,
      ...(supplemental as Partial<SnapshotMetric>),
      pValueAdjusted: supplemental.pValueAdjusted,
      ciAdjusted: supplemental.ciAdjusted,
    });
  });
}

/**
 * The most affected of the displayed treatment variations. Null when no
 * variation can be compared: no supplemental result, an errored result, or a
 * metric short of its minimum sample size.
 */
function classifyMetric(
  metricResults: MetricResults,
  { field, rule }: { field: SupplementalField; rule: AdjustmentRule },
  args: AdjustmentImpactArgs,
): AdjustmentClassification | null {
  const { metric, variations } = metricResults;
  const { baselineIndex, variationFilter, metricDefaults } = args;
  const baseline = variations[baselineIndex];
  if (!baseline) return null;

  const unadjustedVariations = getVariationForSupplementalResult({
    metricResults,
    field,
  });
  const statusArgs = { ...args, metric };

  let worst: AdjustmentClassification | null = null;
  variations.forEach((adjusted, index) => {
    if (index === baselineIndex || variationFilter?.includes(index)) return;
    if (!adjusted.supplementalResults?.[field]) return;

    const unadjusted = unadjustedVariations[index];
    // An errored result reports a lift of zero, which would read as a shift.
    if (adjusted.errorMessage || unadjusted.errorMessage) return;
    if (!hasEnoughData(baseline, adjusted, metric, metricDefaults)) return;

    const classification = classifyPair({
      adjusted,
      unadjusted,
      adjustedSignificant: getMetricResultStatus({
        ...statusArgs,
        baseline,
        stats: adjusted,
      }).significant,
      unadjustedSignificant: getMetricResultStatus({
        ...statusArgs,
        baseline: unadjustedVariations[baselineIndex],
        stats: unadjusted,
      }).significant,
      rule,
    });
    if (!worst || bySeverity(classification, worst) < 0) worst = classification;
  });

  return worst;
}

/** For each metric, the adjustments that apply to it, most severe first. */
export function getAdjustmentImpactSummaries({
  metrics,
  ...args
}: AdjustmentImpactArgs & {
  metrics: MetricResults[];
}): AdjustmentImpact[][] {
  const settings = args.settings ?? DEFAULT_ADJUSTMENT_IMPACT_SETTINGS;
  const adjustments = ADJUSTMENTS.map(({ field, label }) => ({
    field,
    label,
    rule: settings[field],
  }));

  return metrics.map((metricResults) =>
    adjustments
      .flatMap((adjustment): AdjustmentImpact[] => {
        const classification = classifyMetric(metricResults, adjustment, args);
        const { field, label } = adjustment;
        return classification ? [{ field, label, ...classification }] : [];
      })
      .sort(bySeverity),
  );
}
