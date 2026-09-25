import { ReactNode } from "react";
import { Flex, Skeleton } from "@radix-ui/themes";
import { stemRuleId } from "shared/util";
import { FeatureUsageLookback } from "shared/types/integrations";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import { RULE_TRAFFIC_LOOKBACK, useFeatureUsage } from "./FeatureUsageGraph";
import styles from "./RuleTrafficFigures.module.scss";

/**
 * "matched", not "users" and not "evaluations".
 *
 * The figure is `COUNT(*)` over `feature_usage` rows: SDK calls, not people.
 * The table has no user or device identifier, so a distinct-user count is not
 * derivable from it. "evaluations" alone would leave open whether the rule
 * matched or was merely evaluated; the unit, and the not-people caveat, live in
 * the tooltip.
 */
const UNIT_LABEL = "matched";

/**
 * The tooltip names the window the count was actually read over, taken from the
 * same constant the fetch uses, so the copy cannot claim a window the query did
 * not scan.
 */
const WINDOW_LABEL: Record<FeatureUsageLookback, string> = {
  "15minute": "15 minutes",
  hour: "hour",
  day: "24 hours",
  week: "7 days",
};

/**
 * Height of the rule card's kebab button (Radix IconButton size="2" = 32px).
 *
 * The lead row reserves exactly this height and centres inside it, so the
 * figure's optical centre lands on the kebab's without either side hard-coding
 * the other's metrics. Rule.tsx gives the kebab the same treatment; both read
 * this constant so the two can't drift.
 */
export const RULE_FIGURE_ROW_HEIGHT = 32;

export type RuleTrafficState = "traffic" | "disabled" | "unreachable";

/**
 * The cluster's lead row. Whatever sits here — a figure or a status pill —
 * lines up with the kebab; anything after it stacks underneath.
 */
function LeadRow({ children }: { children: ReactNode }) {
  return (
    <Flex
      align="center"
      justify="end"
      style={{ minHeight: RULE_FIGURE_ROW_HEIGHT }}
    >
      {children}
    </Flex>
  );
}

/**
 * Radix Skeleton over the figure's own content: the content stays in the DOM
 * with visibility:hidden, so the block is exactly as wide as the value it
 * covers and nothing moves when the new value lands. The wrapping span renders
 * in both states, so the DOM shape doesn't change either.
 */
function FigureSkeleton({
  loading,
  children,
}: {
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <Skeleton loading={loading} className={styles.skeleton}>
      <span style={{ display: "inline-flex" }}>{children}</span>
    </Skeleton>
  );
}

/** Sizes the skeleton on a first load, when there is no previous value. */
const FIRST_LOAD_PLACEHOLDER = "0,000";

interface Props {
  ruleId: string | undefined;
  /** Rule is off, or its experiment/rollout has stopped. */
  inactive: boolean;
  /** Preceding rules already claim every request that could reach this one. */
  unreachable: boolean;
}

export default function RuleTrafficFigures({
  ruleId,
  inactive,
  unreachable,
}: Props) {
  const { ruleFeatureUsage, ruleTrafficLoading, showFeatureUsage } =
    useFeatureUsage();

  if (!showFeatureUsage) return null;

  /**
   * A disabled rule gets no count at all rather than a zero. Zero is true but
   * it is a tautology — the rule is off, so of course nothing matched — and
   * rendered as a figure it reads as evidence that the rule is unused.
   */
  if (inactive) {
    return (
      <LeadRow>
        <Badge label="Disabled" color="gray" variant="soft" radius="full" />
      </LeadRow>
    );
  }

  if (unreachable) {
    return (
      <LeadRow>
        <Tooltip
          body="Earlier rules match every request that could reach this one."
          tipPosition="top"
          usePortal
        >
          <Badge
            label="Unreachable"
            color="amber"
            variant="soft"
            radius="full"
          />
        </Tooltip>
      </LeadRow>
    );
  }

  // Not loading and still nothing: the fetch failed. Say nothing rather than
  // read an error as "Never matched".
  if (!ruleFeatureUsage && !ruleTrafficLoading) return null;

  const rows = ruleFeatureUsage?.byRuleId ?? [];
  const stem = ruleId ? stemRuleId(ruleId) : "";

  let count = 0;
  rows.forEach((d) =>
    Object.entries(d.v).forEach(([k, n]) => {
      if (stem && k === stem) count += n || 0;
    }),
  );

  // While refreshing, the previous response is still here and decides which
  // shape is skeletoned. On a first load there is none, so it's the figure.
  if (ruleFeatureUsage && (!stem || count === 0)) {
    return (
      <LeadRow>
        <Tooltip
          shouldDisplay={!ruleTrafficLoading}
          body={`No evaluations matched this rule in the last ${WINDOW_LABEL[RULE_TRAFFIC_LOOKBACK]}.`}
          tipPosition="top"
          usePortal
        >
          <FigureSkeleton loading={ruleTrafficLoading}>
            <Badge
              label="Never matched"
              color="gray"
              variant="soft"
              radius="full"
            />
          </FigureSkeleton>
        </Tooltip>
      </LeadRow>
    );
  }

  return (
    <Tooltip
      shouldDisplay={!ruleTrafficLoading}
      body={`Number of evaluations matched this rule in the last ${WINDOW_LABEL[RULE_TRAFFIC_LOOKBACK]}`}
      tipPosition="top"
      usePortal
    >
      <LeadRow>
        {/* Baseline, not center: the figure is semibold and its unit is not,
            so baseline keeps the two sitting on one line of type. */}
        <FigureSkeleton loading={ruleTrafficLoading}>
          <Flex align="baseline" gap="1">
            {/* semibold is the top of @/ui/Text's ladder (600 per
              radix-config); there is no 700 step to ask for. */}
            <Text
              size="sm"
              weight="semibold"
              color="text-high"
              whiteSpace="nowrap"
            >
              {ruleFeatureUsage
                ? count.toLocaleString()
                : FIRST_LOAD_PLACEHOLDER}
            </Text>
            <Text size="sm" color="text-high" whiteSpace="nowrap">
              {UNIT_LABEL}
            </Text>
          </Flex>
        </FigureSkeleton>
      </LeadRow>
    </Tooltip>
  );
}
