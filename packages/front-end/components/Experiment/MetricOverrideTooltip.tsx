import { Box, Flex } from "@radix-ui/themes";
import { getMetricLink } from "shared/experiments";
import { MetricOverride } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { describeMetricOverride } from "@/services/metricOverrides";
import {
  OptionTooltipDescription,
  OptionTooltipRow,
  OptionTooltipSection,
  OptionTooltipShell,
} from "@/components/Features/OptionTooltipShell";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

/**
 * A selected metric's hover card: where it lives, and what this experiment
 * changes about it. A group lists each of its metrics that is overridden.
 */
export function MetricOverrideTooltipContent({
  id,
  overrides,
  onManageOverrides,
}: {
  id: string;
  overrides: MetricOverride[];
  /** Opens the override editor on these metrics; omitted where it can't open. */
  onManageOverrides?: (metricIds: string[]) => void;
}) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const group = getMetricGroupById(id);
  const metric = group ? null : getExperimentMetricById(id);
  const memberIds = group ? group.metrics : [id];
  const nameOf = (mid: string) => getExperimentMetricById(mid)?.name || mid;

  const overridden = memberIds
    .map((mid) => ({
      mid,
      rows: describeMetricOverride(
        overrides.find((o) => o.id === mid) ?? { id: mid },
      ),
    }))
    .filter(({ rows }) => rows.length > 0);

  return (
    <OptionTooltipShell
      href={group ? `/metric-groups/${id}` : getMetricLink(id)}
      title={group?.name ?? metric?.name ?? id}
    >
      {group ? (
        <OptionTooltipRow label="Metrics:">
          {group.metrics.length}
        </OptionTooltipRow>
      ) : (
        <OptionTooltipDescription description={metric?.description} />
      )}
      {overridden.length ? (
        <OptionTooltipSection label="Overrides in this experiment:">
          <Flex direction="column" gap="2" mt="1">
            {overridden.map(({ mid, rows }) => (
              <Box key={mid}>
                {group ? (
                  <Text size="sm" as="div" weight="medium">
                    {nameOf(mid)}
                  </Text>
                ) : null}
                {rows.map((row) => (
                  <OptionTooltipRow key={row.label} label={`${row.label}:`}>
                    {row.value}
                  </OptionTooltipRow>
                ))}
              </Box>
            ))}
          </Flex>
        </OptionTooltipSection>
      ) : null}
      {onManageOverrides ? (
        <Box>
          <Link onClick={() => onManageOverrides(memberIds)}>
            {overridden.length ? "Manage overrides" : "Add overrides"}
          </Link>
        </Box>
      ) : null}
    </OptionTooltipShell>
  );
}
