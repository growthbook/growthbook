import { useCallback } from "react";
import { PiArrowDown, PiArrowUp } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { QueryInterface } from "shared/types/query";
import { formatNumericLikeForDisplay } from "shared/util";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Text from "@/ui/Text";
import useExplorationTableData from "./useExplorationTableData";

export default function ExplorerDataTable({
  exploration,
  error,
  submittedExploreState,
  loading,
  hasChart = false,
  isStale = false,
  query = null,
  compareEnabled = false,
  comparisonExploration = null,
  serverTableTrendsByRow = null,
}: {
  exploration: ProductAnalyticsExploration | null;
  error: string | null;
  submittedExploreState: ExplorationConfig | null;
  loading: boolean;
  hasChart?: boolean;
  isStale?: boolean;
  query?: QueryInterface | null;
  compareEnabled?: boolean;
  comparisonExploration?: ProductAnalyticsExploration | null;
  serverTableTrendsByRow?: Record<string, number | null>[] | null;
}) {
  const {
    rowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
    csvColumnKeys,
    csvColumnLabels,
    tableCompareActive,
    compareColumnMetaByKey,
  } = useExplorationTableData(exploration, submittedExploreState, {
    compareEnabled,
    comparisonExploration,
    serverTableTrendsByRow,
  });

  const renderCell = useCallback(
    (key: string, value: unknown, row: Record<string, unknown>) => {
      if (!tableCompareActive) {
        return formatNumericLikeForDisplay(value);
      }
      const colMeta = compareColumnMetaByKey?.[key];
      if (
        colMeta?.compareCell !== "current" ||
        typeof row[colMeta.trendRowKey] !== "number" ||
        Number.isNaN(row[colMeta.trendRowKey] as number)
      ) {
        return formatNumericLikeForDisplay(value);
      }
      const trendRaw = row[colMeta.trendRowKey] as number;
      const valueString = formatNumericLikeForDisplay(value);
      const flat = trendRaw === 0;
      const trendColor = flat
        ? undefined
        : trendRaw > 0
          ? "var(--green-9)"
          : "var(--red-9)";
      return (
        <Flex align="center" gap="2">
          <Text size="medium">{valueString}</Text>
          <span
            style={{
              color: trendColor ?? "var(--color-text-mid)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {!flat &&
              (trendRaw > 0 ? (
                <PiArrowUp
                  style={{ verticalAlign: "middle", flexShrink: 0 }}
                  size={12}
                  color={trendColor}
                />
              ) : (
                <PiArrowDown
                  style={{ verticalAlign: "middle", flexShrink: 0 }}
                  size={12}
                  color={trendColor}
                />
              ))}
            {`${Math.abs(trendRaw).toFixed(2)}%`}
          </span>
        </Flex>
      );
    },
    [tableCompareActive, compareColumnMetaByKey],
  );

  return (
    <DisplayTestQueryResults
      results={rowData}
      duration={query?.statistics?.executionDurationMs ?? 0}
      sql={query?.query || ""}
      error={error || ""}
      showNoRowsWarning={explorationReturnedNoData && !hasChart}
      allowDownload={true}
      showSampleHeader={false}
      showDuration={!!query?.statistics}
      headerStructure={headerStructure ?? undefined}
      orderedColumnKeys={orderedColumnKeys}
      columnLabels={columnLabels}
      csvColumnKeys={csvColumnKeys}
      csvColumnLabels={csvColumnLabels}
      renderCell={renderCell}
      paddingTop={(isStale || loading) && !hasChart ? 35 : 0}
    />
  );
}
