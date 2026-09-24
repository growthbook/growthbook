import { Fragment } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiPlusBold,
  PiSlidersHorizontal,
} from "react-icons/pi";
import { ExperimentMetricDefinition, getMetricLink } from "shared/experiments";
import { MetricOverride } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { metricTypeLabel } from "@/services/metrics";
import {
  describeMetricOverride,
  METRIC_OVERRIDE_COLOR,
  OverrideRow,
} from "@/services/metricOverrides";
import {
  OptionTooltipDescription,
  OptionTooltipRow,
  OptionTooltipSection,
  OptionTooltipShell,
} from "@/components/Features/OptionTooltipShell";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

const ICON_STYLE = { verticalAlign: "-2px", marginRight: 4 };

/** A group member as the selector sees it: whether it can join the query. */
export interface GroupMemberStatus {
  metric: ExperimentMetricDefinition | null;
  joinable: boolean;
}

/**
 * A metric's overrides under a blue heading, the blue the chip is outlined in,
 * so the two read as the same signal. Nothing when it has none.
 */
function OverridesBlock({ rows }: { rows: OverrideRow[] }) {
  if (!rows.length) return null;
  return (
    <Box mt="2">
      <Box style={{ color: METRIC_OVERRIDE_COLOR }}>
        <Text size="sm" as="div" weight="semibold">
          Overrides:
        </Text>
      </Box>
      {rows.map((row) => (
        <OptionTooltipRow key={row.label} label={`${row.label}:`}>
          {row.value}
        </OptionTooltipRow>
      ))}
    </Box>
  );
}

/**
 * A selected metric's hover card: where it lives, and what this experiment
 * changes about it. A group lists every metric in it, each with its own
 * type and overrides, linked to its own page.
 */
export function MetricOverrideTooltipContent({
  id,
  overrides,
  onManageOverrides,
  members,
  filterConversionWindowMetrics,
}: {
  id: string;
  overrides: MetricOverride[];
  /** Opens the override editor on these metrics; omitted where it can't open. */
  onManageOverrides?: (metricIds: string[]) => void;
  /** For a group, how each of its metrics fares against the query. */
  members?: GroupMemberStatus[];
  /** Whether a conversion window counts against a metric here. */
  filterConversionWindowMetrics?: boolean;
}) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const group = getMetricGroupById(id);
  const metric = group ? null : getExperimentMetricById(id);
  const memberIds = group ? group.metrics : [id];
  const rowsFor = (mid: string) =>
    describeMetricOverride(overrides.find((o) => o.id === mid) ?? { id: mid });
  const hasOverrides = memberIds.some((mid) => rowsFor(mid).length > 0);

  return (
    <OptionTooltipShell
      href={group ? `/metric-groups/${id}` : getMetricLink(id)}
      title={group?.name ?? metric?.name ?? id}
      subtitle={metric ? metricTypeLabel(metric) : undefined}
      titleColor="dark"
    >
      {onManageOverrides ? (
        <Box>
          {/* Inline, not in a flex box: underline doesn't reach into one. */}
          <Link onClick={() => onManageOverrides(memberIds)}>
            {hasOverrides ? (
              <PiSlidersHorizontal style={ICON_STYLE} />
            ) : (
              <PiPlusBold style={ICON_STYLE} />
            )}
            {hasOverrides ? "Manage overrides" : "Add overrides"}
          </Link>
        </Box>
      ) : null}
      {group ? (
        <OptionTooltipSection label="Metrics:">
          <Flex direction="column" gap="2" mt="1">
            {memberIds.map((mid, i) => {
              const member = getExperimentMetricById(mid);
              const status = members?.find((m) => m.metric?.id === mid);
              const notJoinable = status ? !status.joinable : false;
              const conversionWindow =
                !!filterConversionWindowMetrics &&
                member?.windowSettings?.type === "conversion";
              const rows = rowsFor(mid);
              return (
                <Fragment key={mid}>
                  {i > 0 ? <Separator size="4" /> : null}
                  <Box>
                    {member ? (
                      <>
                        <Link
                          href={getMetricLink(mid)}
                          target="_blank"
                          color="dark"
                          weight="medium"
                          size="sm"
                        >
                          {member.name} <PiArrowSquareOut />
                        </Link>
                        <Text size="sm" as="div" color="text-low">
                          {metricTypeLabel(member)}
                        </Text>
                      </>
                    ) : (
                      <Text size="sm" weight="medium">
                        {mid}
                      </Text>
                    )}
                    {notJoinable ? (
                      <HelperText status="error" size="sm">
                        Not joinable with this assignment query
                      </HelperText>
                    ) : conversionWindow ? (
                      <HelperText status="warning" size="sm">
                        Uses a conversion window
                      </HelperText>
                    ) : null}
                    <OverridesBlock rows={rows} />
                  </Box>
                </Fragment>
              );
            })}
          </Flex>
        </OptionTooltipSection>
      ) : (
        <>
          <OptionTooltipDescription description={metric?.description} />
          <OverridesBlock rows={rowsFor(id)} />
        </>
      )}
    </OptionTooltipShell>
  );
}
