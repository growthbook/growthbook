import { FC, useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DifferenceType,
  PValueCorrection,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { RadixColor } from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import { ExperimentTableRow } from "@/services/experiments";
import {
  AdjustmentEffectSize,
  formatAdjustmentChange,
  formatAdjustmentQualifiers,
  getAdjustmentImpactSummary,
  getFamilyAdjustedPValues,
  SupplementalField,
} from "./helpers";

interface MetricDrilldownAdjustmentSummaryProps {
  row: ExperimentTableRow;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  baselineRow: number;
  variationFilter?: number[];
  significanceThresholds: SignificanceThresholds;
  /**
   * Used to recompute family-wide adjusted p-values.
   */
  goalRows?: ExperimentTableRow[];
  pValueCorrection?: PValueCorrection;
  /**
   * When provided, adjustment labels become links that jump to the matching
   * detailed comparison table below.
   */
  onAdjustmentClick?: (field: SupplementalField) => void;
}

const EFFECT_SIZE_DISPLAY: Record<
  AdjustmentEffectSize,
  { label: string; color: RadixColor }
> = {
  small: { label: "Small effect", color: "gray" },
  moderate: { label: "Moderate effect", color: "amber" },
  large: { label: "Large effect", color: "amber" },
};

const MetricDrilldownAdjustmentSummary: FC<
  MetricDrilldownAdjustmentSummaryProps
> = ({
  row,
  statsEngine,
  differenceType,
  baselineRow,
  variationFilter,
  significanceThresholds,
  goalRows,
  pValueCorrection,
  onAdjustmentClick,
}) => {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { bayesianConfidenceLevels, pValueThreshold } = significanceThresholds;
  const { ciUpper, ciLower } = bayesianConfidenceLevels;

  const familyAdjustedPValues = useMemo(
    () => getFamilyAdjustedPValues({ goalRows, statsEngine, pValueCorrection }),
    [goalRows, statsEngine, pValueCorrection],
  );

  const summary = useMemo(
    () =>
      getAdjustmentImpactSummary({
        row,
        baselineRow,
        variationFilter,
        metricDefaults,
        statsEngine,
        differenceType,
        ciUpper,
        ciLower,
        pValueThreshold,
        familyAdjustedPValues,
      }),
    [
      row,
      baselineRow,
      variationFilter,
      metricDefaults,
      statsEngine,
      differenceType,
      ciUpper,
      ciLower,
      pValueThreshold,
      familyAdjustedPValues,
    ],
  );

  if (summary.length === 0) {
    return null;
  }

  return (
    <Box mb="5">
      <Heading as="h4" size="md" weight="medium" mb="3">
        Adjustment Summary
      </Heading>
      <Flex direction="row" gap="8" wrap="wrap">
        {summary.map(
          ({
            field,
            label,
            effectSize,
            relativeChange,
            significanceChanged,
            signFlipped,
          }) => {
            const display = EFFECT_SIZE_DISPLAY[effectSize];
            const changeText = formatAdjustmentChange(relativeChange);
            const qualifiers = formatAdjustmentQualifiers({
              significanceChanged,
              signFlipped,
            });
            const tooltipBody = (
              <>
                <div>{changeText}</div>
                {qualifiers ? <div>({qualifiers})</div> : null}
              </>
            );
            return (
              <Flex
                key={field}
                align="center"
                gap="2"
                style={{ minWidth: 120 }}
              >
                {onAdjustmentClick ? (
                  <Link
                    size="sm"
                    weight="medium"
                    onClick={() => onAdjustmentClick(field)}
                  >
                    {label}
                  </Link>
                ) : (
                  <Text size="sm" weight="medium">
                    {label}
                  </Text>
                )}
                <Tooltip content={tooltipBody}>
                  <span tabIndex={0} style={{ display: "inline-flex" }}>
                    <Badge label={display.label} color={display.color} />
                  </span>
                </Tooltip>
              </Flex>
            );
          },
        )}
      </Flex>
    </Box>
  );
};

export default MetricDrilldownAdjustmentSummary;
