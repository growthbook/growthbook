import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { ago, datetime } from "shared/dates";
import { getEffectiveMetricValue } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import {
  formatPreviewHeadline,
  getMetricPreviewPartLabels,
  getMetricPreviewSummary,
} from "@/components/FactTables/MetricEditor/metricPreview";
import { fillDailyBuckets } from "@/components/FactTables/MetricEditor/activityChart";
import FunnelChart from "./FunnelChart";
import DailyBarChart from "./DailyBarChart";

// The metric editor's preview: a headline value over daily bars for one
// metric. Errors are shown by the caller.
export default function MetricPreviewChart({
  exploration,
  submittedExploreState,
  loading,
  error,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
  loading: boolean;
  error: string | null;
}) {
  const { getFactMetricById } = useDefinitions();

  if (error && !loading) return null;
  if (loading && !exploration) {
    return (
      <Flex p="4" align="center" justify="center">
        <LoadingSpinner />
      </Flex>
    );
  }
  if (!exploration) return null;

  const dataset = submittedExploreState.dataset;
  if (dataset.type === "funnel") {
    return (
      <FunnelChart
        exploration={exploration}
        submittedExploreState={submittedExploreState}
        compact
      />
    );
  }

  const rows = exploration.result?.rows ?? [];
  if (!rows.some((row) => row.values?.length)) {
    return (
      <Flex p="4" align="center" justify="center">
        <Text color="text-mid" weight="medium">
          The query ran successfully, but no data was returned.
        </Text>
      </Flex>
    );
  }

  // Read the submitted definition so stale results keep their own labels.
  const value = dataset.type === "metric" ? dataset.values[0] : null;
  const metric =
    value?.draftMetric ?? getFactMetricById(value?.metricId ?? "") ?? null;
  if (!metric) return null;

  const parts = getMetricPreviewPartLabels(metric.metricType);
  const summary = getMetricPreviewSummary(rows, metric);
  const perUnit =
    metric.metricType === "ratio" ||
    submittedExploreState.showAs === "per_unit";
  const cellsByDay = new Map(
    rows.map((row) => [String(row.dimensions[0] ?? ""), row.values?.[0]]),
  );
  const days = fillDailyBuckets(Array.from(cellsByDay.keys()).sort(), {
    dateStart: exploration.dateStart,
    dateEnd: exploration.dateEnd,
  });
  const dailyValue = (day: string) => {
    const cell = cellsByDay.get(day);
    return cell
      ? getEffectiveMetricValue(cell, {
          showAs: perUnit ? "per_unit" : "total",
          isRatio: perUnit,
        })
      : 0;
  };

  return (
    <Flex direction="column" minWidth="0" width="100%">
      <Box pb="2" minWidth="0">
        <Text as="div" color="text-mid">
          {summary?.label}
          {summary?.date && (
            <>
              {" · "}
              <Tooltip content={datetime(summary.date)}>
                <span>{ago(summary.date)}</span>
              </Tooltip>
            </>
          )}
        </Text>
        <Flex align="start" gap="1" minWidth="0">
          <div
            title={summary?.value?.toLocaleString()}
            style={{
              fontSize: "3rem",
              lineHeight: 1.2,
              fontWeight: 600,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {(summary?.value ?? null) === null
              ? "—"
              : formatPreviewHeadline(summary?.value ?? 0)}
          </div>
          <Tooltip
            content={
              <Box>
                <Text as="div" size="sm">
                  {summary?.label}
                </Text>
                {parts && (
                  <Text as="div" size="sm">
                    {parts.numerator} / {parts.denominatorTotal}
                  </Text>
                )}
                {metric.metricType === "proportion" && (
                  <Text as="div" size="sm">
                    Units matching the metric’s conditions each day, not an
                    experiment conversion rate. A unit may appear on multiple
                    days.
                  </Text>
                )}
              </Box>
            }
          >
            <Button
              variant="ghost"
              color="gray"
              size="sm"
              aria-label="What this number means"
            >
              <PiInfo />
            </Button>
          </Tooltip>
        </Flex>
        {parts && summary && summary.denominator !== null && (
          <Text as="div" color="text-mid">
            ={" "}
            {summary.numerator.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            /{" "}
            {summary.denominator.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </Text>
        )}
      </Box>
      <DailyBarChart
        days={days}
        values={days.map(dailyValue)}
        seriesName={metric.name}
        tooltipLines={(day, value) => {
          const cell = cellsByDay.get(day);
          const lines = [`Value: ${formatPreviewHeadline(value)}`];
          if (parts) {
            lines.push(
              `${parts.numerator}: ${formatPreviewHeadline(cell?.numerator ?? 0)}`,
              `${parts.denominator}: ${formatPreviewHeadline(cell?.denominator ?? 0)}`,
            );
          }
          return lines;
        }}
      />
    </Flex>
  );
}
