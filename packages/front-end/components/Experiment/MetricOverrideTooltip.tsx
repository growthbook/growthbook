import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentMetricDefinition,
  getMetricLink,
  isFactMetric,
} from "shared/experiments";
import { MetricOverride } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  describeMetricOverride,
  OverrideRow,
} from "@/services/metricOverrides";
import {
  OptionPopover,
  OptionTooltipDescription,
  OptionTooltipRow,
  OptionTooltipSection,
  OptionTooltipShell,
  OptionTooltipTags,
} from "@/components/Features/OptionTooltipShell";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

/** A group member as the selector sees it: whether it can join the query. */
export interface GroupMemberStatus {
  metric: ExperimentMetricDefinition | null;
  joinable: boolean;
}

/** "dailyParticipation" → "Daily participation". */
function metricTypeLabel(metric: ExperimentMetricDefinition): string {
  const type = isFactMetric(metric) ? metric.metricType : metric.type;
  const words = type.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A metric's basic facts, for a metric named inside another card. */
function MetricInfoContent({ metric }: { metric: ExperimentMetricDefinition }) {
  return (
    <OptionTooltipShell href={getMetricLink(metric.id)} title={metric.name}>
      <OptionTooltipRow label="Type:">
        {metricTypeLabel(metric)}
      </OptionTooltipRow>
      <OptionTooltipTags tags={metric.tags} />
      <OptionTooltipDescription description={metric.description} />
    </OptionTooltipShell>
  );
}

function OverrideRows({ rows }: { rows: OverrideRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <OptionTooltipRow key={row.label} label={`${row.label}:`}>
          {row.value}
        </OptionTooltipRow>
      ))}
    </>
  );
}

/**
 * A selected metric's hover card: where it lives, and what this experiment
 * changes about it. A group lists every metric in it, each with its own
 * overrides and a card of its own on hover.
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
    >
      {group ? (
        <OptionTooltipSection label="Metrics:">
          <Flex direction="column" gap="2" mt="1">
            {memberIds.map((mid) => {
              const member = getExperimentMetricById(mid);
              const status = members?.find((m) => m.metric?.id === mid);
              const notJoinable = status ? !status.joinable : false;
              const conversionWindow =
                !!filterConversionWindowMetrics &&
                member?.windowSettings?.type === "conversion";
              const rows = rowsFor(mid);
              return (
                <Box key={mid}>
                  {member ? (
                    <OptionPopover
                      content={<MetricInfoContent metric={member} />}
                    >
                      <Text size="sm" weight="medium">
                        {member.name}
                      </Text>
                    </OptionPopover>
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
                  <OverrideRows rows={rows} />
                </Box>
              );
            })}
          </Flex>
        </OptionTooltipSection>
      ) : (
        <>
          <OptionTooltipDescription description={metric?.description} />
          {hasOverrides ? (
            <OptionTooltipSection label="Overrides in this experiment:">
              <Box mt="1">
                <OverrideRows rows={rowsFor(id)} />
              </Box>
            </OptionTooltipSection>
          ) : null}
        </>
      )}
      {onManageOverrides ? (
        <Box>
          <Link onClick={() => onManageOverrides(memberIds)}>
            {hasOverrides ? "Manage overrides" : "Add overrides"}
          </Link>
        </Box>
      ) : null}
    </OptionTooltipShell>
  );
}
