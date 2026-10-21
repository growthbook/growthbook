import { useState } from "react";
import isEqual from "lodash/isEqual";
import EChartsReact from "echarts-for-react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { populationEndpoints } from "shared/api-endpoints";
import type {
  ApiPopulation,
  ApiPopulationAnalysis,
  PopulationMembershipResult,
} from "shared/validators";
import { ago, date, datetime } from "shared/dates";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import LoadingSpinner from "@/components/LoadingSpinner";
import { usePopulationAnalysis } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import {
  cssColorToHex,
  getChartThemeColors,
} from "@/enterprise/components/ProductAnalytics/chart-theme";

type ChartView = "total" | "new";

function isOutOfDate(
  population: ApiPopulation,
  analysis: ApiPopulationAnalysis,
): boolean {
  return (
    analysis.userIdType !== population.userIdTypes[0] ||
    !isEqual(analysis.steps, population.steps)
  );
}

export default function PopulationMembers({
  population,
}: {
  population: ApiPopulation;
}) {
  const { analysis, loading, error, mutate } = usePopulationAnalysis(
    population.id,
  );
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const datasource = getDatasourceById(population.datasource);
  const canRefresh =
    !!datasource && permissionsUtil.canRunFactQueries(datasource);
  const running = analysis?.status === "running";

  const refresh = async () => {
    setRefreshError(null);
    const { analysis: started } = await restApiCall(
      populationEndpoints.refreshPopulation,
      { params: { id: population.id } },
    );
    await mutate({ analysis: started }, { revalidate: false });
  };

  return (
    <Box>
      <Flex justify="between" align="center" gap="3" mb="3" wrap="wrap">
        <Heading as="h2" size="md" mb="0">
          Members
        </Heading>
        <Flex align="center" gap="3">
          {analysis && !running && (
            <Text size="sm" color="text-mid">
              Refreshed{" "}
              <Tooltip content={datetime(analysis.dateCreated)}>
                <span>{ago(analysis.dateCreated)}</span>
              </Tooltip>
            </Text>
          )}
          {canRefresh && (
            <Button
              variant="outline"
              size="sm"
              icon={<PiArrowClockwise />}
              loading={running}
              disabled={running}
              onClick={refresh}
              setError={setRefreshError}
            >
              {analysis ? "Refresh" : "Calculate members"}
            </Button>
          )}
        </Flex>
      </Flex>

      {refreshError && (
        <Callout status="error" mb="3">
          {refreshError}
        </Callout>
      )}
      {error && (
        <Callout status="error" mb="3">
          {error.message}
        </Callout>
      )}
      {analysis &&
        analysis.status !== "running" &&
        isOutOfDate(population, analysis) && (
          <Callout status="info" mb="3">
            The definition changed after these members were calculated.
            {canRefresh ? " Refresh to update them." : ""}
          </Callout>
        )}
      {analysis?.status === "error" && (
        <Callout status="error" mb="3">
          {analysis.error || "The membership query failed."}
        </Callout>
      )}

      {loading ? (
        <Flex p="4" align="center" justify="center">
          <LoadingSpinner />
        </Flex>
      ) : running && !analysis?.result ? (
        <Flex p="4" gap="2" align="center" justify="center">
          <LoadingSpinner />
          <Text color="text-mid">Calculating members…</Text>
        </Flex>
      ) : analysis?.result ? (
        <PopulationMembersResult result={analysis.result} />
      ) : !analysis ? (
        <Text size="sm" color="text-mid">
          {canRefresh
            ? "Members haven't been calculated yet."
            : "Members haven't been calculated yet. Ask someone who can run queries on this Data Source to calculate them."}
        </Text>
      ) : null}
    </Box>
  );
}

function formatChange(value: number, sign: "+" | "−"): string {
  return value === 0 ? "0" : `${sign}${value.toLocaleString()}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text as="div" size="sm" color="text-mid">
        {label}
      </Text>
      <Text as="div" size="xl" weight="semibold">
        {value}
      </Text>
    </Box>
  );
}

function PopulationMembersResult({
  result,
}: {
  result: PopulationMembershipResult;
}) {
  const [view, setView] = useState<ChartView>("total");
  const { theme } = useAppearanceUITheme();
  const { textColor, tooltipBackgroundColor } = getChartThemeColors(theme);
  const { summary, series } = result;
  const values = series.map((point) =>
    view === "total" ? point.members : point.joined,
  );

  return (
    <Box>
      <Grid
        columns="repeat(3, auto)"
        gapX="6"
        gapY="2"
        mb="4"
        width="fit-content"
      >
        <Stat label="Members" value={summary.members.toLocaleString()} />
        <Stat
          label="Joined, last 30 days"
          value={formatChange(summary.joined, "+")}
        />
        <Stat
          label="Left, last 30 days"
          value={formatChange(summary.left, "−")}
        />
      </Grid>

      <Flex justify="between" align="center" mb="2" wrap="wrap" gap="2">
        <Tabs value={view} onValueChange={(v) => setView(v as ChartView)}>
          <TabsList size="sm">
            <TabsTrigger value="total">Total members</TabsTrigger>
            <TabsTrigger value="new">New members</TabsTrigger>
          </TabsList>
        </Tabs>
        <Text size="sm" color="text-mid">
          Weekly, last 12 months · as of {date(result.asOf, "UTC")}
        </Text>
      </Flex>

      <EChartsReact
        key={theme}
        notMerge
        option={{
          grid: { top: 16, right: 8, bottom: 28, left: 48 },
          tooltip: {
            appendTo: "body",
            trigger: "axis",
            padding: [10, 14],
            backgroundColor: tooltipBackgroundColor,
            textStyle: { color: textColor },
            formatter: (params: unknown) => {
              const point = (Array.isArray(params) ? params[0] : params) as {
                dataIndex?: number;
              };
              const week = series[point?.dataIndex ?? -1];
              if (!week) return "";
              return [
                `<strong>Week ending ${date(week.date, "UTC")}</strong>`,
                `Members: ${week.members.toLocaleString()}`,
                `Joined: ${week.joined.toLocaleString()}`,
                `Left: ${week.left.toLocaleString()}`,
              ].join("<br/>");
            },
          },
          xAxis: {
            type: "category",
            data: series.map((point) => date(point.date, "UTC")),
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: cssColorToHex("var(--gray-10)") },
          },
          yAxis: {
            type: "value",
            axisLabel: { color: cssColorToHex("var(--gray-10)") },
            splitLine: {
              lineStyle: { color: cssColorToHex("var(--gray-a4)") },
            },
          },
          series: [
            {
              name: view === "total" ? "Members" : "Joined",
              type: "line",
              data: values,
              showSymbol: false,
              lineStyle: { color: cssColorToHex("var(--violet-9)") },
              itemStyle: { color: cssColorToHex("var(--violet-9)") },
              areaStyle: {
                color: cssColorToHex("var(--violet-9)"),
                opacity: 0.6,
              },
            },
          ],
        }}
        style={{ width: "100%", height: 260 }}
      />
    </Box>
  );
}
