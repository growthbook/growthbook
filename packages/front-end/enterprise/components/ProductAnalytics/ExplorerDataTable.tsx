import { MetricExplorerBlockInterface } from "shared/enterprise";
import { useMemo } from "react";
import { date } from "shared/dates";
import { Box, Text, Flex } from "@radix-ui/themes";
import { FactMetricInterface, FactTableInterface } from "shared/types/fact-table";
import { useCurrency } from "@/hooks/useCurrency";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import { ChartSeriesData } from "./ExplorerChart";
import { MetricSeriesConfig, FactTableSeriesConfig } from "./MetricExplorer";
import { SeriesAnalysis, getSeriesTableData } from "./types";

// Helper to get series display name
function getSeriesDisplayName(seriesData: ChartSeriesData): string {
  if (seriesData.factMetric) {
    return seriesData.factMetric.name;
  }
  if (seriesData.factTable) {
    const config = seriesData.series.config as FactTableSeriesConfig;
    const valueTypeLabel = config.valueType === "count" 
      ? "Count" 
      : config.valueType === "unit_count" 
        ? `${config.unitType || "Units"} Count`
        : `Sum of ${config.valueColumn || "value"}`;
    return `${seriesData.factTable.name} (${valueTypeLabel})`;
  }
  return seriesData.series.name;
}

interface ExplorerDataTableProps {
  block: MetricExplorerBlockInterface;
  factMetric?: FactMetricInterface;
  allSeriesData?: ChartSeriesData[];
}

// Helper component for rendering a single series data table
function SeriesDataTable({
  block,
  seriesData,
}: {
  block: MetricExplorerBlockInterface;
  seriesData: ChartSeriesData;
}) {
  const { analysisSettings } = block;
  const { getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();

  // Determine value type from the series config
  let valueType: "sum" | "avg" = "avg";
  let valueLabel = "Value";
  
  if (seriesData.series.type === "metric" && seriesData.factMetric) {
    const config = seriesData.series.config as MetricSeriesConfig;
    valueType = config?.valueType || "avg";
    valueLabel = valueType === "sum"
      ? seriesData.factMetric.metricType === "proportion" ? "Count" : "Sum"
      : seriesData.factMetric.metricType === "proportion" ? "Proportion" : "Average";
  } else if (seriesData.series.type === "factTable") {
    const config = seriesData.series.config as FactTableSeriesConfig;
    valueType = config.valueType === "sum" ? "sum" : "avg";
    valueLabel = config.valueType === "count" 
      ? "Count" 
      : config.valueType === "unit_count" 
        ? "Unit Count"
        : "Sum";
  }

  const formatterOptions = useMemo(
    () => ({ currency: displayCurrency }),
    [displayCurrency]
  );

  const { rows, formatter } = useMemo(() => {
    // Use metric formatter if available, otherwise use a basic number formatter
    let formatter: (value: number) => string;
    
    if (seriesData.factMetric) {
      const rawFormatter = getExperimentMetricFormatter(
        seriesData.factMetric,
        getFactTableById,
        valueType === "sum" ? "number" : "percentage"
      );
      formatter = (value: number) => rawFormatter(value, formatterOptions);
    } else {
      // Basic number formatter for fact table series
      formatter = (value: number) => {
        if (Math.abs(value) >= 1000000) {
          return `${(value / 1000000).toFixed(2)}M`;
        } else if (Math.abs(value) >= 1000) {
          return `${(value / 1000).toFixed(1)}K`;
        }
        return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      };
    }

    // Get table data from the analysis (from useSeriesAnalysis hook)
    const tableData = getSeriesTableData(seriesData.analysis || null, valueType);
    
    // Add formatted dates and filter by date range
    const rows = tableData
      .map((d) => ({
        ...d,
        dateFormatted: date(d.date),
      }))
      .filter((d) => {
        if (d.date < analysisSettings.startDate) return false;
        if (d.date > analysisSettings.endDate) return false;
        return true;
      });

    return { rows, formatter };
  }, [
    seriesData.factMetric,
    seriesData.analysis,
    valueType,
    analysisSettings.startDate,
    analysisSettings.endDate,
    formatterOptions,
    getFactTableById,
  ]);

  if (!rows.length) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text size="2" style={{ color: "var(--gray-9)" }}>
          No data available for this series
        </Text>
      </Box>
    );
  }

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
            <th>Date</th>
            <th style={{ textAlign: "right" }}>{valueLabel}</th>
            <th style={{ textAlign: "right" }}>Units</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{row.dateFormatted}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatter(row.value)}
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {row.units.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export default function ExplorerDataTable({
  block,
  factMetric,
  allSeriesData,
}: ExplorerDataTableProps) {
  // Use allSeriesData if provided, otherwise fall back to single series
  const seriesDataList = useMemo(() => {
    if (allSeriesData && allSeriesData.length > 0) {
      return allSeriesData;
    }
    if (factMetric) {
      return [{ 
        series: { id: "default", color: "#8b5cf6" }, 
        factMetric, 
        index: 0, 
        tag: "A" 
      }] as ChartSeriesData[];
    }
    return [];
  }, [allSeriesData, factMetric]);

  if (seriesDataList.length === 0) {
    return null;
  }

  // Always show tabs for consistency
  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
      }}
    >
      <Tabs defaultValue={seriesDataList[0].tag}>
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
        {seriesDataList.map((seriesData) => (
          <TabsTrigger key={seriesData.tag} value={seriesData.tag}>
            <Flex align="center" gap="2">
              <Box
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: seriesData.series.color,
                }}
              />
              <span>{seriesData.tag}: {getSeriesDisplayName(seriesData)}</span>
            </Flex>
          </TabsTrigger>
        ))}
      </TabsList>
    </Flex>
    {seriesDataList.map((seriesData) => (
      <TabsContent key={seriesData.tag} value={seriesData.tag}>
        <SeriesDataTable
          block={block}
          seriesData={seriesData}
        />
      </TabsContent>
    ))}
      </Tabs>
    </Box>
  );
}
