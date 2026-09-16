import { FC, useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DifferenceType,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { RadixColor } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ExperimentTableRow } from "@/services/experiments";
import {
  AdjustmentEffectSize,
  getAdjustmentImpactSummary,
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
   * When provided, adjustment labels become links that jump to the matching
   * detailed comparison table below.
   */
  onAdjustmentClick?: (field: SupplementalField) => void;
}

const EFFECT_SIZE_DISPLAY: Record<
  AdjustmentEffectSize,
  { label: string; color: RadixColor }
> = {
  little: { label: "Little effect", color: "gray" },
  moderate: { label: "Moderate effect", color: "blue" },
  large: { label: "Large effect", color: "orange" },
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
  onAdjustmentClick,
}) => {
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { bayesianConfidenceLevels, pValueThreshold } = significanceThresholds;
  const { ciUpper, ciLower } = bayesianConfidenceLevels;

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
    ],
  );

  if (summary.length === 0) {
    return null;
  }

  return (
    <Box mb="5">
      <Heading as="h4" size="md" weight="medium" mb="3">
        Summary
      </Heading>
      <Flex align="center" gap="1" mb="2">
        <Text size="sm" color="text-low">
          How much each adjustment changed this metric&apos;s result.
        </Text>
        <Tooltip body="An effect is large when statistical significance changes, the sign of the lift flips, or the lift changes by at least 10%; an effect is small when the estimate changes by at least 1%." />
      </Flex>
      <Flex direction="column" gap="2">
        {summary.map(({ field, label, effectSize }) => {
          const display = EFFECT_SIZE_DISPLAY[effectSize];
          return (
            <Flex key={field} align="center" gap="3">
              <Box style={{ width: 160 }}>
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
              </Box>
              <Badge label={display.label} color={display.color} />
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
};

export default MetricDrilldownAdjustmentSummary;
