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
import { ExperimentTableRow } from "@/services/experiments";
import {
  AdjustmentEffectSize,
  AdjustmentImpact,
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
  small: { label: "Small effect", color: "gray" },
  moderate: { label: "Moderate effect", color: "amber" },
  large: { label: "Large effect", color: "orange" },
};

function formatAdjustmentDelta({
  relativeChange,
  significanceChanged,
  signFlipped,
}: Pick<
  AdjustmentImpact,
  "relativeChange" | "significanceChanged" | "signFlipped"
>): string {
  const parts = [`${(relativeChange * 100).toFixed(1)}% estimate change`];
  if (signFlipped) parts.push("sign flip");
  if (significanceChanged) parts.push("significance change");
  return parts.join(" · ");
}

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
      <Text as="p" size="sm" color="text-low" mb="2">
        How much each adjustment changed this metric&apos;s result.
      </Text>
      <Flex direction="row" gap="5" wrap="wrap">
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
            return (
              <Flex
                key={field}
                direction="column"
                align="start"
                gap="1"
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
                <Badge label={display.label} color={display.color} />
                <Text size="sm" color="text-low">
                  {formatAdjustmentDelta({
                    relativeChange,
                    significanceChanged,
                    signFlipped,
                  })}
                </Text>
              </Flex>
            );
          },
        )}
      </Flex>
    </Box>
  );
};

export default MetricDrilldownAdjustmentSummary;
