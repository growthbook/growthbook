import { useMemo } from "react";
import { Flex, Skeleton } from "@radix-ui/themes";
import clsx from "clsx";
import { PiArrowClockwiseBold, PiClock } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import DataFreshness from "@/components/Diagnostics/DataFreshness";
import { useFeatureUsage } from "./FeatureUsageGraph";
import RuleFilterButton from "./RuleFilterButton";
import {
  buildRuleTrafficSegments,
  RuleTrafficSegment,
} from "./featureEvaluationsBreakdown";
import styles from "./RuleTrafficCard.module.scss";

const formatter = new Intl.NumberFormat("en-US");
// Legend counts, abbreviated: the percentage beside them carries the reading,
// the count only its scale. The bar's total line keeps the full number.
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatShare(count: number, denominator: number): string {
  if (denominator <= 0) return "—";
  const share = (count / denominator) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return `${share.toFixed(1)}%`;
}

const NO_RULE_EXPLANATION =
  "Evaluations no rule produced: SDK overrides, failed prerequisites, and " +
  "SDKs whose payload doesn't include this flag at all (unknownFeature). " +
  "The Source breakdown on the Diagnostics tab separates them.";

function LegendRow({
  segment,
  denominator,
}: {
  segment: RuleTrafficSegment;
  denominator: number;
}) {
  const isRule = segment.kind === "rule";
  const row = (
    <div className={clsx(styles.row, !isRule && styles.rowMuted)}>
      {/* The pill is what cross-references the rule card on the left, since
          the two cards are not row-aligned. Non-rules hold the column. */}
      <span className={clsx(styles.pill, !isRule && styles.pillBlank)}>
        {segment.index ?? ""}
      </span>
      {/* The default value's swatch is an empty outline, as in the
          Diagnostics breakdown panel; its bar segment keeps the grey fill. */}
      <span
        className={clsx(
          styles.swatch,
          segment.kind === "default" && styles.swatchDefault,
        )}
        style={
          segment.kind === "default" ? undefined : { background: segment.color }
        }
      />
      <span className={styles.name} title={segment.label}>
        {segment.label}
      </span>
      <span className={styles.share}>
        {formatShare(segment.count, denominator)}
      </span>
      <span className={styles.count} title={formatter.format(segment.count)}>
        {compact.format(segment.count)}
      </span>
    </div>
  );
  return segment.kind === "none" ? (
    <Tooltip body={NO_RULE_EXPLANATION} tipPosition="top" usePortal>
      {row}
    </Tooltip>
  ) : (
    row
  );
}

/**
 * Where the flag's evaluations went over the last 7 days, rule by rule, read
 * as one flow: a 100% bar in rule order, then the default value, then what no
 * rule produced. Reads the provider's existing 7-day rule-traffic fetch — no
 * query of its own. Renders nothing without usage data (no managed warehouse).
 */
export default function RuleTrafficCard({
  feature,
  experimentsMap,
}: {
  feature: FeatureInterface;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
}) {
  const {
    showFeatureUsage,
    ruleFeatureUsage,
    ruleTrafficRowsMeta,
    ruleTrafficLoading,
    refreshRuleTraffic,
    usageUpdatedAt,
  } = useFeatureUsage();

  const traffic = useMemo(
    () =>
      ruleFeatureUsage
        ? buildRuleTrafficSegments({
            rules: feature.rules ?? [],
            experimentsMap,
            byRuleId: ruleFeatureUsage.byRuleId,
            total: ruleFeatureUsage.total,
            includedEvaluations:
              ruleTrafficRowsMeta?.ruleId?.includedEvaluations,
            // Holdout occupies slot #1, as on the rule cards.
            ruleNumberOffset: feature.holdout?.id ? 2 : 1,
          })
        : null,
    [
      ruleFeatureUsage,
      ruleTrafficRowsMeta,
      feature.rules,
      feature.holdout,
      experimentsMap,
    ],
  );

  if (!showFeatureUsage) return null;

  const loading = ruleTrafficLoading;
  const drawn = traffic?.segments.filter((s) => s.count > 0) ?? [];

  return (
    <div className={styles.card}>
      {/* "Traffic" with its window beneath; the freshness stamp inline with
          the refresh control it describes. */}
      <Flex align="start" justify="between" gap="2" className={styles.header}>
        <div>
          <Heading as="h4" size="sm" mb="0">
            Traffic
          </Heading>
          <div className={styles.window}>Last 7 Days</div>
        </div>
        <Flex align="center" gap="2" flexShrink="0">
          {loading ? (
            <Flex align="center" gap="1" style={{ whiteSpace: "nowrap" }}>
              <PiClock size={12} color="var(--color-text-low)" />
              <Text size="sm" color="text-mid" whiteSpace="nowrap">
                Refreshing…
              </Text>
            </Flex>
          ) : (
            <DataFreshness
              updatedAt={usageUpdatedAt}
              // The time alone: beside the refresh control and under a
              // "Traffic" heading, what it measures is already clear.
              verb=""
              icon={<PiClock size={12} color="var(--color-text-low)" />}
            />
          )}
          <RuleFilterButton
            label="Refresh rule traffic"
            icon={<PiArrowClockwiseBold size={12} />}
            // Can't be pressed again while the counts are still loading.
            spinning={loading}
            disabled={loading}
            onClick={() => refreshRuleTraffic()}
          />
        </Flex>
      </Flex>

      {!traffic && !loading ? (
        <div className={styles.note}>Traffic couldn&apos;t be loaded.</div>
      ) : (
        <>
          <Skeleton loading={loading && !traffic} className={styles.skeleton}>
            {/* An empty track with no traffic, rather than no bar: the shape
                stays, and the caption says why it is empty. */}
            <div className={styles.bar}>
              {drawn.map((segment) => (
                <span
                  key={segment.key}
                  className={styles.segment}
                  style={{
                    flexGrow: segment.count,
                    background: segment.color,
                  }}
                  title={`${segment.label}: ${formatShare(
                    segment.count,
                    traffic?.denominator ?? 0,
                  )}`}
                />
              ))}
            </div>
          </Skeleton>
          {traffic && (
            <>
              <div className={styles.caption}>
                {traffic.denominator > 0
                  ? `${formatter.format(traffic.denominator)} evaluations`
                  : "No evaluations in the last 7 days"}
              </div>
              {traffic.notBrokenDown > 0 && (
                <div className={styles.captionMuted}>
                  {`${formatter.format(
                    traffic.notBrokenDown,
                  )} more not broken down by rule`}
                </div>
              )}
              <div className={styles.legend}>
                {/* A zero "served without a rule" is not a finding: the row
                    and its segment are omitted, like the cap line at 0. */}
                {traffic.segments
                  .filter((s) => !(s.kind === "none" && s.count === 0))
                  .map((segment) => (
                    <LegendRow
                      key={segment.key}
                      segment={segment}
                      denominator={traffic.denominator}
                    />
                  ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
