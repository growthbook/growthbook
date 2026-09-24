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
  OptionTooltipSection,
  OptionTooltipShell,
} from "@/components/Features/OptionTooltipShell";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

/** A group member as the selector sees it: whether it can join the query. */
export interface GroupMemberStatus {
  metric: ExperimentMetricDefinition | null;
  joinable: boolean;
}

/**
 * A metric's overrides under a blue heading, the blue the chip is outlined in,
 * so the two read as the same signal, and lighter than the metric names.
 * Nothing when it has none. `nested` under a group's member, set in a step so
 * the members' names still lead down the card.
 */
function OverridesBlock({
  rows,
  nested = false,
}: {
  rows: OverrideRow[];
  nested?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <Box mt={nested ? "2" : undefined} pl={nested ? "2" : undefined}>
      <Box style={{ color: METRIC_OVERRIDE_COLOR }}>
        <Text size="sm" as="div" weight="medium">
          Overrides:
        </Text>
      </Box>
      {rows.map((row) => (
        <Text key={row.label} size="sm" as="div" color="text-high">
          <Text size="sm" color="text-low">
            {row.label}:
          </Text>{" "}
          {row.value}
        </Text>
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
      {/* Clamped short, so it can sit with the name it describes. */}
      {metric ? (
        <OptionTooltipDescription description={metric.description} />
      ) : null}
      {onManageOverrides ? (
        <Box>
          <Button
            variant="outline"
            size="sm"
            icon={hasOverrides ? <PiSlidersHorizontal /> : <PiPlusBold />}
            onClick={() => onManageOverrides(memberIds)}
          >
            {hasOverrides ? "Manage overrides" : "Add overrides"}
          </Button>
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
                    <OverridesBlock rows={rows} nested />
                  </Box>
                </Fragment>
              );
            })}
          </Flex>
        </OptionTooltipSection>
      ) : (
        <OverridesBlock rows={rowsFor(id)} />
      )}
    </OptionTooltipShell>
  );
}
