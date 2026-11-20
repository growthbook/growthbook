import { z } from "zod";
import {
  DifferenceType,
  IndexedPValue,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";
import {
  adjustPValuesBenjaminiHochberg,
  adjustPValuesHolmBonferroni,
  ExperimentMetricDefinition,
  getAdjustedCI,
  getMetricResultStatus,
  hasEnoughData,
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

interface CorrectionArgs {
  statsEngine: StatsEngine;
  pValueThreshold: number;
  /** All non-slice goal rows, the family for adjusted p-values. */
  goalRows?: AdjustmentImpactRow[];
  pValueCorrection?: PValueCorrection;
}

export interface AdjustmentImpactArgs extends CorrectionArgs {
  baselineRow: number;
  variationFilter?: number[];
  metricDefaults: MetricDefaults;
  differenceType: DifferenceType;
  ciUpper: number;
  ciLower: number;
  settings?: AdjustmentImpactSettings;
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
function getLiftStandardError(stats: SnapshotMetric): number {
  const stddev = stats.uplift?.stddev;
  if (stats.uplift?.dist !== "normal") return 0;
  return stddev !== undefined && Number.isFinite(stddev) ? stddev : 0;
}

function classifyPair({
  primary,
  alt,
  primarySignificant,
  altSignificant,
  rule,
}: {
  primary: SnapshotMetric;
  alt: SnapshotMetric;
  primarySignificant: boolean;
  altSignificant: boolean;
  rule: AdjustmentRule;
}): AdjustmentClassification {
  const primaryLift = primary.expected ?? 0;
  const altLift = alt.expected ?? 0;
  const shift = Math.abs(primaryLift - altLift);
  const largerLift = Math.max(Math.abs(primaryLift), Math.abs(altLift));
  const relativeChange = largerLift === 0 ? 0 : shift / largerLift;

  // The larger standard error, so that the shift is not overstated.
  const standardError = Math.max(
    getLiftStandardError(primary),
    getLiftStandardError(alt),
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

  // A corrected result is not comparable with one whose correction could not
  // be recomputed.
  const comparable =
    primary.pValueAdjusted === undefined || alt.pValueAdjusted !== undefined;
  // A sign flip between two non-significant results is noise around zero.
  const significantSignFlip =
    Math.sign(primaryLift) * Math.sign(altLift) < 0 &&
    (primarySignificant || (comparable && altSignificant));
  const significanceDiffers =
    comparable && primarySignificant !== altSignificant;
  const triggered =
    shiftSize >= thresholds.largeWithTrigger &&
    (significantSignFlip ||
      (rule.largeTrigger === "statusChange" && significanceDiffers));

  const large =
    triggered || (thresholds.large !== null && shiftSize >= thresholds.large);
  const moderate = shiftSize >= thresholds.moderate;

  return {
    effectSize: large ? "large" : moderate ? "moderate" : "small",
    relativeChange,
    standardErrorShift,
    significanceChanged: triggered && significanceDiffers,
    signFlipped: triggered && significantSignFlip,
  };
}

const P_VALUE_ADJUSTERS: Record<
  NonNullable<PValueCorrection>,
  (pValues: IndexedPValue[]) => IndexedPValue[]
> = {
  "benjamini-hochberg": adjustPValuesBenjaminiHochberg,
  "holm-bonferroni": adjustPValuesHolmBonferroni,
};

// The goal metrics' corrected p-values as they would be without one
// adjustment, by metric and variation. Null when there is no correction.
function getSupplementalAdjustedPValues({
  field,
  statsEngine,
  goalRows,
  pValueCorrection,
}: CorrectionArgs & { field: SupplementalField }): Map<string, number> | null {
  if (statsEngine !== "frequentist" || !pValueCorrection || !goalRows) {
    return null;
  }

  // A metric the adjustment does not apply to (e.g. an uncapped metric, for
  // capping) has no supplemental result and keeps its own p-value, since it is
  // the same either way.
  const pValues = goalRows.flatMap(({ metric, variations }) =>
    variations.flatMap((stats, index): IndexedPValue[] => {
      if (stats.pValue === undefined) return []; // not part of the family
      const supplemental = stats.supplementalResults?.[field] as
        | { pValue?: number }
        | undefined;
      return [
        {
          pValue: supplemental?.pValue ?? stats.pValue,
          index: [0, index, metric.id],
        },
      ];
    }),
  );
  if (pValues.length === 0) return null;

  return new Map(
    P_VALUE_ADJUSTERS[pValueCorrection](pValues).map(({ pValue, index }) => [
      `${index[2]}:${index[1]}`,
      pValue,
    ]),
  );
}

function applySupplemental(
  row: AdjustmentImpactRow,
  field: SupplementalField,
  pValueThreshold: number,
  adjustedPValues: Map<string, number> | null,
): SnapshotMetric[] {
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
 * A row's results as they would be without one adjustment. The displayed
 * result's multiple-testing-corrected p-value and interval do not carry over:
 * they are recomputed, or cleared when they cannot be.
 */
export function getSupplementalVariations({
  row,
  field,
  ...correction
}: CorrectionArgs & {
  row: AdjustmentImpactRow;
  field: SupplementalField;
}): SnapshotMetric[] {
  return applySupplemental(
    row,
    field,
    correction.pValueThreshold,
    getSupplementalAdjustedPValues({ ...correction, field }),
  );
}

/**
 * The most affected of the displayed treatment variations. Null when no
 * variation can be compared: no supplemental result, an errored result, or a
 * metric short of its minimum sample size.
 */
function classifyRow(
  row: AdjustmentImpactRow,
  {
    field,
    rule,
    adjustedPValues,
  }: {
    field: SupplementalField;
    rule: AdjustmentRule;
    adjustedPValues: Map<string, number> | null;
  },
  args: AdjustmentImpactArgs,
): AdjustmentClassification | null {
  const { baselineRow, variationFilter, metricDefaults } = args;
  const baseline = row.variations[baselineRow];
  if (!baseline) return null;

  const altVariations = applySupplemental(
    row,
    field,
    args.pValueThreshold,
    adjustedPValues,
  );
  const statusArgs = { ...args, metric: row.metric };

  let worst: AdjustmentClassification | null = null;
  row.variations.forEach((primary, index) => {
    if (index === baselineRow || variationFilter?.includes(index)) return;
    if (!primary.supplementalResults?.[field]) return;

    const alt = altVariations[index];
    // An errored result reports a lift of zero, which would read as a shift.
    if (primary.errorMessage || alt.errorMessage) return;
    if (!hasEnoughData(baseline, primary, row.metric, metricDefaults)) return;

    const classification = classifyPair({
      primary,
      alt,
      primarySignificant: getMetricResultStatus({
        ...statusArgs,
        baseline,
        stats: primary,
      }).significant,
      altSignificant: getMetricResultStatus({
        ...statusArgs,
        baseline: altVariations[baselineRow],
        stats: alt,
      }).significant,
      rule,
    });
    if (!worst || isMoreSevere(classification, worst)) worst = classification;
  });

  return worst;
}

/** For each row, the adjustments that apply to it, most severe first. */
export function getAdjustmentImpactSummaries({
  rows,
  ...args
}: AdjustmentImpactArgs & {
  rows: AdjustmentImpactRow[];
}): AdjustmentImpact[][] {
  const settings = args.settings ?? DEFAULT_ADJUSTMENT_IMPACT_SETTINGS;
  // The correction spans the goal metrics, so it is done once for all rows.
  const adjustments = ADJUSTMENTS.map(({ field, label }) => ({
    field,
    label,
    rule: settings[field],
    adjustedPValues: getSupplementalAdjustedPValues({ ...args, field }),
  }));

  return rows.map((row) =>
    adjustments
      .flatMap((adjustment): AdjustmentImpact[] => {
        const classification = classifyRow(row, adjustment, args);
        const { field, label } = adjustment;
        return classification ? [{ field, label, ...classification }] : [];
      })
      // Ties break on relative change, which is comparable across adjustments
      // judged on different scales.
      .sort((a, b) => {
        if (SEVERITY_RANK[a.effectSize] !== SEVERITY_RANK[b.effectSize]) {
          return SEVERITY_RANK[b.effectSize] - SEVERITY_RANK[a.effectSize];
        }
        return b.relativeChange - a.relativeChange;
      }),
  );
}
