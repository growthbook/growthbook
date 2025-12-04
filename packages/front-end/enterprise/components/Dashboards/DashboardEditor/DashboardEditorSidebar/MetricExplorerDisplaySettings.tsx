import React, { useMemo, useCallback } from "react";
import { Flex, Text, Box } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { FactTableInterface } from "back-end/types/fact-table";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { PiPalette } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import Checkbox from "@/ui/Checkbox";

interface SeriesInfo {
  seriesId: string;
  label: string;
  type: "base" | "auto" | "custom";
  column?: string;
  columnDisplayName?: string;
  level?: string;
  slice?: Record<string, string | null>;
}

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  factTable: FactTableInterface | null;
}

export default function MetricExplorerDisplaySettings({
  block,
  setBlock,
  factTable,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");

  // Helper to format slice label (matches MetricExplorerBlock logic)
  const formatSliceLabel = (slice: Record<string, string | null>): string => {
    const parts = Object.entries(slice)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([col, val]) => {
        if (val === null) {
          return `${col}: null`;
        }
        return `${col}: ${val}`;
      });
    return parts.join(" + ");
  };

  // Calculate all series from block configuration (not from data)
  const allSeries = useMemo(() => {
    const series: SeriesInfo[] = [];

    // Check if we have any slices configured
    const hasAutoSlices =
      (block.analysisSettings.metricAutoSlices?.length ?? 0) > 0;
    const hasCustomSlices =
      (block.analysisSettings.customMetricSlices?.length ?? 0) > 0;

    // If no slices, return base metric
    if (!hasAutoSlices && !hasCustomSlices) {
      return [
        {
          seriesId: "",
          label: "Base",
          type: "base" as const,
        },
      ];
    }

    // Process auto slices
    if (hasAutoSlices && factTable) {
      block.analysisSettings.metricAutoSlices?.forEach((columnName) => {
        const column = factTable.columns.find((c) => c.column === columnName);
        if (!column?.autoSlices) return;

        const columnDisplayName = column.name || columnName;

        column.autoSlices.forEach((level) => {
          const slice = { [columnName]: level };
          const seriesId = formatSliceLabel(slice);

          series.push({
            seriesId,
            label: level || "",
            type: "auto",
            column: columnName,
            columnDisplayName,
            level: level || "",
            slice,
          });
        });
      });
    }

    // Process custom slices
    if (hasCustomSlices && factTable) {
      block.analysisSettings.customMetricSlices?.forEach((customSlice) => {
        // Build slice object from custom slice configuration
        const slice: Record<string, string | null> = {};
        customSlice.slices.forEach((s) => {
          // Use first level (custom slices typically have one level per column)
          slice[s.column] = s.levels[0] || null;
        });

        const seriesId = formatSliceLabel(slice);

        // Build display label
        const label = customSlice.slices
          .sort((a, b) => a.column.localeCompare(b.column))
          .map((s) => {
            const columnInfo = factTable.columns.find(
              (c) => c.column === s.column,
            );
            const columnName = columnInfo?.name || s.column;
            return `${columnName}: ${s.levels[0] || ""}`;
          })
          .join(", ");

        series.push({
          seriesId,
          label,
          type: "custom",
          slice,
        });
      });
    }

    return series;
  }, [
    block.analysisSettings.metricAutoSlices,
    block.analysisSettings.customMetricSlices,
    factTable,
  ]);

  // Check if a series is enabled (not hidden)
  const isSeriesEnabled = useCallback(
    (seriesId: string) => {
      const config = block.displaySettings?.seriesOverrides?.find(
        (c) => c.seriesId === seriesId,
      );
      // Default to shown (not hidden) if no config exists
      return config?.hidden !== true;
    },
    [block.displaySettings?.seriesOverrides],
  );

  // Only show the section if there are series to display
  if (allSeries.length === 0) {
    return null;
  }

  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Collapsible
        trigger={
          <div
            style={{
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingTop: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--gray-a3)",
            }}
          >
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              <Flex justify="between" align="center" mb="1" mt="1">
                <Flex align="center" gap="1">
                  <PiPalette
                    style={{
                      color: "var(--violet-11)",
                    }}
                    size={20}
                  />
                  Display Settings
                </Flex>
                <FaAngleRight className="chevron" />
              </Flex>
            </Text>
          </div>
        }
        transitionTime={100}
      >
        <Box p="4" height="fit-content">
          <Flex direction="column" gap="4">
            <div>
              <label className="font-weight-bold mb-1">Series</label>
              <Text
                as="p"
                className="mb-2"
                style={{ color: "var(--color-text-mid)" }}
              >
                Customize which series are displayed on the chart.
              </Text>
              <Flex direction="column" gap="2">
                {(() => {
                  // Group series by column (for auto slices) or by type (for custom/base)
                  const baseSeries = allSeries.filter((s) => s.type === "base");
                  const autoSeries = allSeries.filter((s) => s.type === "auto");
                  const customSeries = allSeries.filter(
                    (s) => s.type === "custom",
                  );

                  // Group auto series by column
                  const autoSeriesByColumn = new Map<
                    string,
                    {
                      columnName: string;
                      series: SeriesInfo[];
                    }
                  >();
                  autoSeries.forEach((series) => {
                    if (series.column && series.columnDisplayName) {
                      if (!autoSeriesByColumn.has(series.column)) {
                        autoSeriesByColumn.set(series.column, {
                          columnName: series.columnDisplayName,
                          series: [],
                        });
                      }
                      autoSeriesByColumn
                        .get(series.column)!
                        .series.push(series);
                    }
                  });

                  // Disable checkbox if this is the only series (user must show at least one)
                  const isOnlySeries = allSeries.length === 1;
                  const isDisabled = !hasMetricSlicesFeature || isOnlySeries;

                  const renderSeriesCheckbox = (series: SeriesInfo) => (
                    <Flex key={series.seriesId} align="center" gap="2">
                      <Checkbox
                        value={isSeriesEnabled(series.seriesId)}
                        disabled={isDisabled}
                        setValue={(checked) => {
                          // checked is true when user wants to show, false when wants to hide
                          // We want to hide when checked is false, show when checked is true
                          const currentOverrides =
                            block.displaySettings?.seriesOverrides || [];
                          const existingIndex = currentOverrides.findIndex(
                            (c) => c.seriesId === series.seriesId,
                          );

                          let newOverrides: typeof currentOverrides;
                          if (checked) {
                            // User wants to show - remove from config if it exists
                            if (existingIndex >= 0) {
                              newOverrides = currentOverrides.filter(
                                (_, i) => i !== existingIndex,
                              );
                            } else {
                              newOverrides = currentOverrides;
                            }
                          } else {
                            // User wants to hide - add or update config
                            if (existingIndex >= 0) {
                              newOverrides = [...currentOverrides];
                              newOverrides[existingIndex] = {
                                ...newOverrides[existingIndex],
                                hidden: true,
                              };
                            } else {
                              newOverrides = [
                                ...currentOverrides,
                                { seriesId: series.seriesId, hidden: true },
                              ];
                            }
                          }

                          setBlock({
                            ...block,
                            displaySettings: {
                              ...block.displaySettings,
                              seriesOverrides:
                                newOverrides && newOverrides.length > 0
                                  ? newOverrides
                                  : undefined,
                            },
                          });
                        }}
                      />
                      <Text size="2">{series.label}</Text>
                    </Flex>
                  );

                  return (
                    <>
                      {/* Base metric */}
                      {baseSeries.map(renderSeriesCheckbox)}

                      {/* Auto slices grouped by column */}
                      {Array.from(autoSeriesByColumn.entries())
                        .sort((a, b) =>
                          a[1].columnName.localeCompare(b[1].columnName),
                        )
                        .map(
                          ([column, { columnName, series: columnSeries }]) => (
                            <Flex key={column} direction="column" gap="1">
                              <Text
                                size="2"
                                weight="medium"
                                style={{
                                  paddingLeft: "4px",
                                  color: "var(--color-text-mid)",
                                }}
                              >
                                {columnName}
                              </Text>
                              <Flex
                                direction="column"
                                gap="1"
                                style={{ paddingLeft: "16px" }}
                              >
                                {columnSeries
                                  .sort((a, b) =>
                                    (a.level || "").localeCompare(
                                      b.level || "",
                                    ),
                                  )
                                  .map(renderSeriesCheckbox)}
                              </Flex>
                            </Flex>
                          ),
                        )}

                      {/* Custom slices */}
                      {customSeries.length > 0 && (
                        <Flex direction="column" gap="1">
                          <Text
                            size="2"
                            weight="medium"
                            style={{
                              paddingLeft: "4px",
                              color: "var(--color-text-mid)",
                            }}
                          >
                            Custom Slice{customSeries.length > 1 ? "s" : ""}
                          </Text>
                          <Flex
                            direction="column"
                            gap="1"
                            style={{ paddingLeft: "16px" }}
                          >
                            {customSeries.map(renderSeriesCheckbox)}
                          </Flex>
                        </Flex>
                      )}
                    </>
                  );
                })()}
              </Flex>
            </div>
          </Flex>
        </Box>
      </Collapsible>
    </Flex>
  );
}
