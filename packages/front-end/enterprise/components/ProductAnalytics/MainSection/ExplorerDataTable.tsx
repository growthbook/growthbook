import { useMemo } from "react";
import { Box, Text, Flex } from "@radix-ui/themes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { useExplorerContext } from "../ExplorerContext";
import { ProductAnalyticsConfig, ProductAnalyticsResult } from "shared/validators";
import { date } from "shared/dates";

// Helper to get series display name
function getSeriesDisplayName(
  config: ProductAnalyticsConfig | null,
  metricId: string
): string {
  const value = config?.dataset?.values?.find(
    (v) =>
      (v.type === "metric" && v.metricId === metricId) || v.name === metricId
  );
  return value?.name ?? metricId;
}

function getSeriesColor(
  config: ProductAnalyticsConfig | null,
  metricId: string
): string {
  const value = config?.dataset?.values?.find(
    (v) =>
      (v.type === "metric" && v.metricId === metricId) || v.name === metricId
  );
  return value?.color ?? "#8b5cf6";
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface SeriesDataTableProps {
  metricId: string;
  rows: ProductAnalyticsResult["rows"];
  config: ProductAnalyticsConfig | null;
}

function SeriesDataTable({ metricId, rows, config }: SeriesDataTableProps) {
  const tableRows = useMemo(() => {
    return rows.map((row) => {
      const metricValue = row.values.find((v) => v.metricId === metricId);
      return {
        dimension: row.dimensions[0] || "-",
        value: metricValue?.value ?? 0,
        denominator: metricValue?.denominator,
      };
    });
  }, [rows, metricId]);

  if (!tableRows.length) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text size="2" style={{ color: "var(--gray-9)" }}>
          No data available for this series
        </Text>
      </Box>
    );
  }

  // Check if we should format the dimension as a date
  // This is a simple heuristic - if the first dimension looks like a date, format it
  // Ideally we would check the dimension type from the config
  const isDateDimension = useMemo(() => {
    if (!tableRows.length) return false;
    const firstDim = tableRows[0].dimension;
    return !isNaN(Date.parse(firstDim));
  }, [tableRows]);

  return (
    <Box style={{ maxHeight: "300px", overflowY: "auto" }}>
      <table className="table gbtable mb-0">
        <thead
          style={{
            position: "sticky",
            top: 0,
            backgroundColor: "var(--color-background)",
            zIndex: 1,
          }}
        >
          <tr>
            <th>Date / Dimension</th>
            <th style={{ textAlign: "right" }}>Value</th>
            {tableRows.some((r) => r.denominator !== undefined && r.denominator !== null) && (
              <th style={{ textAlign: "right" }}>Denominator</th>
            )}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i}>
              <td>
                {isDateDimension ? date(row.dimension) : row.dimension}
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatNumber(row.value)}
              </td>
              {row.denominator !== undefined && row.denominator !== null && (
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatNumber(row.denominator)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export default function ExplorerDataTable() {
  const { exploreData, submittedExploreState } = useExplorerContext();

  const metricIds = useMemo(() => {
    if (!exploreData?.rows?.length) return [];
    // Get unique metric IDs from the first row
    return exploreData.rows[0].values.map((v) => v.metricId);
  }, [exploreData]);

  if (!exploreData || !metricIds.length) {
    return null;
  }

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
      }}
    >
      <Tabs defaultValue={metricIds[0]}>
        <Flex
          px="4"
          py="2"
          align="center"
          style={{
            borderBottom: "1px solid var(--gray-a3)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <TabsList size="1">
            {metricIds.map((metricId) => (
              <TabsTrigger key={metricId} value={metricId}>
                <Flex align="center" gap="2">
                  <Box
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: getSeriesColor(submittedExploreState, metricId),
                    }}
                  />
                  <span>
                    {getSeriesDisplayName(submittedExploreState, metricId)}
                  </span>
                </Flex>
              </TabsTrigger>
            ))}
          </TabsList>
        </Flex>
        {metricIds.map((metricId) => (
          <TabsContent key={metricId} value={metricId}>
            <SeriesDataTable
              metricId={metricId}
              rows={exploreData.rows}
              config={submittedExploreState}
            />
          </TabsContent>
        ))}
      </Tabs>
    </Box>
  );
}
