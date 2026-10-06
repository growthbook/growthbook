import { useMemo, useState } from "react";
import { ago, datetime } from "shared/dates";
import {
  POPULATION_DATE_RANGE_LABELS,
  POPULATION_DATE_RANGE_PRESETS,
  PopulationDateRangePreset,
} from "shared/populations";
import { ApiPopulation } from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import { Select, SelectItem } from "@/ui/Select";
import {
  usePopulationRefresh,
  usePopulationSnapshotHistory,
} from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import PopulationSizeGraph from "./PopulationSizeGraph";

type ChartValue = "members" | "joined";

export default function PopulationSizePanel({
  population,
}: {
  population: ApiPopulation;
}) {
  const [range, setRange] = useState<PopulationDateRangePreset>("last12Months");
  const [chartValue, setChartValue] = useState<ChartValue>("members");
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const datasource = getDatasourceById(population.datasource);
  const canRefresh =
    !!datasource && permissionsUtil.canRunFactQueries(datasource);

  const history = usePopulationSnapshotHistory(population.id, range);
  const { latest, running, refresh, cancel, error } = usePopulationRefresh(
    population.id,
    history.mutate,
  );

  // Show the newest successful counts, even while a refresh runs or failed.
  const current =
    latest?.status === "success"
      ? latest
      : (history.snapshots[history.snapshots.length - 1] ?? null);
  const counts = current?.result ?? null;

  const points = useMemo(
    () =>
      history.snapshots
        .filter((s) => s.result)
        .map((s) => ({
          date: new Date(s.asOf),
          value:
            chartValue === "members"
              ? (s.result?.membersNow ?? 0)
              : (s.result?.joined ?? 0),
        })),
    [history.snapshots, chartValue],
  );

  const comparisonDays = current?.comparisonDays ?? 30;
  const change = counts ? counts.membersNow - counts.membersPrior : 0;

  return (
    <Frame>
      <Flex justify="between" align="start" gap="3" mb="4">
        <Box>
          <Heading as="h3" size="md" mb="1">
            Population Size
          </Heading>
          <Text size="sm" color="text-mid">
            {running
              ? "Refreshing…"
              : current
                ? `Refreshed ${ago(current.asOf)}`
                : "Not refreshed yet"}
          </Text>
        </Box>
        {canRefresh &&
          (running ? (
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={refresh}>
              Refresh
            </Button>
          ))}
      </Flex>

      {error && (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      )}
      {latest?.status === "error" && !running && (
        <Callout status="error" mb="3">
          The last refresh failed: {latest.error || "Unknown error"}
        </Callout>
      )}

      {!counts ? (
        <Text color="text-mid">
          {running
            ? "Counting members in your Data Source…"
            : canRefresh
              ? "Refresh to count this population's members."
              : "This population hasn't been refreshed yet."}
        </Text>
      ) : (
        <>
          <Grid columns={{ initial: "2", sm: "4" }} gap="4" mb="5">
            <Stat
              label="Members now"
              value={counts.membersNow.toLocaleString()}
              detail={current?.userIdType}
              title={current ? datetime(current.asOf) : undefined}
            />
            <Stat
              label={`Change, ${comparisonDays} days`}
              value={`${change > 0 ? "+" : ""}${change.toLocaleString()}`}
              color={change > 0 ? "green" : change < 0 ? "red" : undefined}
            />
            <Stat
              label={`Joined, last ${comparisonDays} days`}
              value={counts.joined.toLocaleString()}
            />
            <Stat
              label={`Left, last ${comparisonDays} days`}
              value={counts.left.toLocaleString()}
            />
          </Grid>

          <Flex justify="between" align="center" gap="3" mb="2">
            <Select
              value={chartValue}
              setValue={(v) => setChartValue(v as ChartValue)}
              size="sm"
            >
              <SelectItem value="members">Members</SelectItem>
              <SelectItem value="joined">
                {`Joined in prior ${comparisonDays} days`}
              </SelectItem>
            </Select>
            <Select
              value={range}
              setValue={(v) => setRange(v as PopulationDateRangePreset)}
              size="sm"
            >
              {POPULATION_DATE_RANGE_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {POPULATION_DATE_RANGE_LABELS[preset]}
                </SelectItem>
              ))}
            </Select>
          </Flex>
          {points.length ? (
            <PopulationSizeGraph
              points={points}
              valueLabel={chartValue === "members" ? "members" : "joined"}
            />
          ) : (
            <Text color="text-mid">No refreshes in this date range.</Text>
          )}
          {points.length === 1 && (
            <Text as="p" size="sm" color="text-low" mt="2">
              Each refresh adds a point, one per day.
            </Text>
          )}
        </>
      )}
    </Frame>
  );
}

function Stat({
  label,
  value,
  detail,
  title,
  color,
}: {
  label: string;
  value: string;
  detail?: string;
  title?: string;
  color?: "green" | "red";
}) {
  return (
    <Flex direction="column" gap="1" title={title}>
      <Text size="sm" color="text-mid">
        {label}
      </Text>
      <span style={color ? { color: `var(--${color}-11)` } : undefined}>
        <Text size="xl" weight="semibold">
          {value}
        </Text>
      </span>
      {detail && (
        <Text size="sm" color="text-low">
          {detail}
        </Text>
      )}
    </Flex>
  );
}
