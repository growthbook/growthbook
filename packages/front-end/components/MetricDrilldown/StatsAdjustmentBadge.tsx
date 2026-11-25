import { FC, ReactNode, useMemo } from "react";
import { PiWarningFill } from "react-icons/pi";
import {
  AdjustmentImpact,
  getAdjustmentImpactSummaries,
} from "shared/experiments";
import {
  DifferenceType,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { ExperimentTableRow } from "@/services/experiments";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import { formatAdjustmentChange, formatAdjustmentQualifiers } from "./helpers";
import styles from "./StatsAdjustmentBadge.module.scss";

/**
 * The large adjustment impacts on each metric row (slice and step rows get
 * none). `getKey` must be stable and tell apart every row the table renders.
 */
export function useLargeAdjustmentImpacts({
  rows,
  getKey,
  baselineRow,
  variationFilter,
  statsEngine,
  differenceType,
  significanceThresholds,
  ssrPolyfills,
}: {
  rows: ExperimentTableRow[];
  getKey: (row: ExperimentTableRow) => string;
  baselineRow?: number;
  variationFilter?: number[];
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
  significanceThresholds: SignificanceThresholds;
  ssrPolyfills?: SSRPolyfills;
}): (row: ExperimentTableRow) => AdjustmentImpact[] {
  const _metricDefaults = useOrganizationMetricDefaults();
  const { metricDefaults } =
    ssrPolyfills?.useOrganizationMetricDefaults?.() || _metricDefaults;

  const impactsByKey = useMemo(() => {
    const metricRows = rows.filter((row) => !row.isChildRow);
    const summaries = getAdjustmentImpactSummaries({
      metrics: metricRows,
      baselineIndex: baselineRow ?? 0,
      variationFilter,
      statsEngine,
      differenceType,
      metricDefaults,
      ciUpper: significanceThresholds.bayesianConfidenceLevels.ciUpper,
      ciLower: significanceThresholds.bayesianConfidenceLevels.ciLower,
      pValueThreshold: significanceThresholds.pValueThreshold,
    });
    const byKey = new Map<string, AdjustmentImpact[]>();
    metricRows.forEach((row, i) => {
      const large = summaries[i].filter(
        ({ effectSize }) => effectSize === "large",
      );
      if (large.length) byKey.set(getKey(row), large);
    });
    return byKey;
  }, [
    rows,
    getKey,
    baselineRow,
    variationFilter,
    statsEngine,
    differenceType,
    metricDefaults,
    significanceThresholds,
  ]);

  return (row) => impactsByKey.get(getKey(row)) ?? [];
}

function formatImpact(impact: AdjustmentImpact): string {
  const qualifiers = formatAdjustmentQualifiers(impact);
  return `${formatAdjustmentChange(impact)}${
    qualifiers ? ` (${qualifiers})` : ""
  }.`;
}

const StatsAdjustmentBadge: FC<{
  /** Large impacts only, from `useLargeAdjustmentImpacts`. */
  impacts: AdjustmentImpact[];
  onClick?: () => void;
  /** Rendered after the badge, kept on the same line as it. */
  trailing?: ReactNode;
}> = ({ impacts, onClick, trailing }) => {
  if (!impacts.length) return null;

  const label = impacts.length === 1 ? impacts[0].label : "Stats Adjustments";

  const tooltip = (
    <>
      {impacts.length === 1 ? (
        <div>{formatImpact(impacts[0])}</div>
      ) : (
        impacts.map((impact) => (
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
        <>
          <PiWarningFill size={12} />
          {label}
        </>
      }
    />
  );

  // A space rather than a margin: it is dropped when the badge wraps to a new
  // line, so a wrapped badge stays flush with the metric name.
  return (
    <>
      {" "}
      <span className={styles.group}>
        <Tooltip content={tooltip}>
          {onClick ? (
            <Link
              underline="none"
              className={styles.link}
              onClick={onClick}
              aria-label={`${label}: large effect on the estimate. View stats adjustments.`}
            >
              {badge}
            </Link>
          ) : (
            <span tabIndex={0} className={styles.wrapper}>
              {badge}
            </span>
          )}
        </Tooltip>
        {trailing}
      </span>
    </>
  );
};

export default StatsAdjustmentBadge;
