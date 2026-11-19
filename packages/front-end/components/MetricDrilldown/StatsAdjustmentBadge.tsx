import { FC, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import {
  DifferenceType,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { MetricDefaults } from "shared/types/organization";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import { ExperimentTableRow } from "@/services/experiments";
import {
  AdjustmentImpact,
  FamilyAdjustedPValues,
  formatAdjustmentChange,
  formatAdjustmentQualifiers,
  getAdjustmentImpactSummary,
} from "./helpers";
import styles from "./StatsAdjustmentBadge.module.scss";

export interface StatsAdjustmentBadgeSettings {
  baselineRow: number;
  variationFilter?: number[];
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  significanceThresholds: SignificanceThresholds;
  metricDefaults: MetricDefaults;
  familyAdjustedPValues: FamilyAdjustedPValues | null;
}

function formatImpact(impact: AdjustmentImpact): string {
  const qualifiers = formatAdjustmentQualifiers(impact);
  return `${formatAdjustmentChange(impact.relativeChange)}${
    qualifiers ? ` (${qualifiers})` : ""
  }.`;
}

const StatsAdjustmentBadge: FC<{
  row: ExperimentTableRow;
  settings: StatsAdjustmentBadgeSettings;
  onClick?: () => void;
}> = ({ row, settings, onClick }) => {
  const {
    baselineRow,
    variationFilter,
    statsEngine,
    differenceType,
    significanceThresholds,
    metricDefaults,
    familyAdjustedPValues,
  } = settings;

  const largeImpacts = useMemo(
    () =>
      getAdjustmentImpactSummary({
        row,
        baselineRow,
        variationFilter,
        metricDefaults,
        statsEngine,
        differenceType,
        ciUpper: significanceThresholds.bayesianConfidenceLevels.ciUpper,
        ciLower: significanceThresholds.bayesianConfidenceLevels.ciLower,
        pValueThreshold: significanceThresholds.pValueThreshold,
        familyAdjustedPValues,
      }).filter((impact) => impact.effectSize === "large"),
    [
      row,
      baselineRow,
      variationFilter,
      metricDefaults,
      statsEngine,
      differenceType,
      significanceThresholds,
      familyAdjustedPValues,
    ],
  );

  if (!largeImpacts.length) return null;

  const label =
    largeImpacts.length === 1 ? largeImpacts[0].label : "Stats Adjustments";

  const tooltip = (
    <>
      {largeImpacts.length === 1 ? (
        <div>{formatImpact(largeImpacts[0])}</div>
      ) : (
        largeImpacts.map((impact) => (
          <div key={impact.field}>
            {impact.label}: {formatImpact(impact)}
          </div>
        ))
      )}
      {onClick ? <div>Click to view details.</div> : null}
    </>
  );

  const badge = (
    <Badge
      className={styles.badge}
      color="amber"
      variant="soft"
      size="sm"
      label={
        <Flex align="center" gap="1">
          <PiWarningFill size={12} />
          {label}
        </Flex>
      }
    />
  );

  return (
    <Tooltip content={tooltip}>
      {onClick ? (
        <Link className={styles.link} onClick={onClick}>
          {badge}
        </Link>
      ) : (
        <span tabIndex={0} className={styles.wrapper}>
          {badge}
        </span>
      )}
    </Tooltip>
  );
};

export default StatsAdjustmentBadge;
