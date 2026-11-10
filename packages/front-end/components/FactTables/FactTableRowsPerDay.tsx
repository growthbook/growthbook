import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { FactTableInterface } from "shared/types/fact-table";
import type { ExplorationConfig } from "shared/validators";
import { getInitialConfigByBlockType } from "shared/enterprise";
import { ago } from "shared/dates";
import useExploration from "@/enterprise/components/ProductAnalytics/useExploration";
import { getRowsPerDay } from "@/components/QueryPreview/activityChart";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./FactTableRowsPerDay.module.scss";

const RANGE_DAYS = 30;

const CHART_HEIGHT = 96;
// Relative heights of the empty-state bars, as a percent of the tallest
const PLACEHOLDER_BARS = Array.from(
  { length: RANGE_DAYS },
  (_, i) => [62, 68, 54, 75, 83, 46, 100][i % 7],
);

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Counts rows per day through a Product Analytics exploration, which caches
// results. Page load only reads the cache; a warehouse query needs a click.
export default function FactTableRowsPerDay({
  factTable,
}: {
  factTable: Pick<FactTableInterface, "id" | "datasource">;
}) {
  const config = useMemo((): ExplorationConfig => {
    const base = getInitialConfigByBlockType(
      "fact-table-exploration",
      factTable.datasource,
    );
    // Always true for this block type; narrows the dataset
    if (base.type !== "fact_table") return base;
    return {
      ...base,
      chartType: "bar",
      dimensions: [
        { dimensionType: "date", column: "date", dateGranularity: "day" },
      ],
      dateRange: {
        predefined: "last30Days",
        lookbackValue: RANGE_DAYS,
        lookbackUnit: "day",
        startDate: null,
        endDate: null,
      },
      dataset: {
        ...base.dataset,
        factTableId: factTable.id,
        values: [
          {
            name: "Count",
            rowFilters: [],
            type: "fact_table",
            valueType: "count",
            valueColumn: null,
            unit: null,
          },
        ],
      },
    };
  }, [factTable.id, factTable.datasource]);

  const {
    data: exploration,
    checked: checkedCache,
    loading: running,
    error,
    refresh: run,
  } = useExploration(config);

  const chart = exploration ? getRowsPerDay(exploration) : null;
  const max = chart ? Math.max(...chart.counts, 1) : 1;

  return (
    <Frame px="5" py="4" mb="4">
      <Flex gap="6" wrap="wrap" align="stretch">
        <Flex direction="column" gap="1" style={{ flex: "0 0 260px" }}>
          <Heading as="h2" size="sm" mb="0">
            Rows Per Day
          </Heading>
          {chart ? (
            <>
              <Text size="xl" weight="semibold">
                {compact.format(chart.total / chart.days.length)}
              </Text>
              <Text color="text-mid">
                {compact.format(chart.total)} rows in the last{" "}
                {chart.days.length} days
              </Text>
            </>
          ) : (
            <>
              <Text size="xl" weight="semibold" color="text-low">
                —
              </Text>
              <Text color="text-mid">
                {checkedCache
                  ? `Load row counts to see the last ${RANGE_DAYS} days`
                  : "Checking for cached row counts…"}
              </Text>
            </>
          )}
          <Flex align="center" gap="2" mt="2" style={{ whiteSpace: "nowrap" }}>
            {exploration ? (
              <Text size="sm" color="text-mid">
                Updated {ago(exploration.dateUpdated)}
              </Text>
            ) : null}
            {checkedCache ? (
              <Button
                size="sm"
                variant={exploration ? "ghost" : "outline"}
                loading={running}
                icon={exploration ? <PiArrowClockwise /> : undefined}
                onClick={() => run(exploration ? "never" : "preferred")}
              >
                {exploration ? "Refresh" : "Load row counts"}
              </Button>
            ) : null}
          </Flex>
          {error ? (
            <Text size="sm" color="text-mid">
              {error}
            </Text>
          ) : null}
        </Flex>
        {chart ? (
          <figure
            aria-label="Rows per day"
            style={{
              flex: "1 1 480px",
              minWidth: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            <Flex
              align="end"
              gap="2px"
              style={{
                height: CHART_HEIGHT,
                borderBottom: "1px solid var(--gray-a6)",
              }}
            >
              {chart.days.map((day, i) => (
                <Tooltip
                  key={day}
                  content={`${dayLabel(day)}: ${chart.counts[i].toLocaleString()} rows`}
                >
                  {/* Full-height hit target so short bars are easy to hover */}
                  <Box
                    flexGrow="1"
                    height="100%"
                    className={styles.hitTarget}
                    aria-label={`${dayLabel(day)}: ${chart.counts[i].toLocaleString()} rows`}
                  >
                    <Box
                      className={styles.bar}
                      style={{
                        height: `${(chart.counts[i] / max) * 100}%`,
                        minHeight: chart.counts[i] ? 2 : 0,
                      }}
                    />
                  </Box>
                </Tooltip>
              ))}
            </Flex>
            <Flex justify="between" mt="1">
              {[
                chart.days[0],
                chart.days[Math.floor(chart.days.length / 2)],
                chart.days[chart.days.length - 1],
              ].map((day, i) => (
                <Text key={i} size="sm" color="text-mid">
                  {dayLabel(day)}
                </Text>
              ))}
            </Flex>
          </figure>
        ) : (
          <Flex
            align="end"
            gap="2px"
            aria-hidden="true"
            className={styles.placeholder}
            style={{ flex: "1 1 480px", minWidth: 0, height: CHART_HEIGHT }}
          >
            {PLACEHOLDER_BARS.map((height, i) => (
              <span key={i} style={{ height: `${height}%` }} />
            ))}
          </Flex>
        )}
      </Flex>
    </Frame>
  );
}
