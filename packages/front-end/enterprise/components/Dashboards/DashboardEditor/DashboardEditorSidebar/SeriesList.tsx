import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { FactTableInterface } from "back-end/types/fact-table";
import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { PiMagnifyingGlass } from "react-icons/pi";
import { FaAngleRight } from "react-icons/fa";
import Collapsible from "react-collapsible";
import Tooltip from "@/components/Tooltip/Tooltip";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { formatSliceLabel } from "@/services/dataVizConfigUtilities";
import { useDefinitions } from "@/services/DefinitionsContext";

interface SeriesInfo {
  seriesId: string;
  label: string;
  type: "base" | "auto" | "custom";
  column?: string;
  columnDisplayName?: string;
  level?: string;
  slice?: Record<string, string | null>;
}

interface SeriesListProps {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  factTable: FactTableInterface;
  hasMetricSlicesFeature: boolean;
}

interface SeriesCheckboxProps {
  series: SeriesInfo;
  isEnabled: boolean;
  isDisabled: boolean;
  onToggle: (seriesId: string, checked: boolean) => void;
}

function SeriesCheckbox({
  series,
  isEnabled,
  isDisabled,
  onToggle,
}: SeriesCheckboxProps) {
  return (
    <Flex align="center" gap="2">
      <Checkbox
        value={isEnabled}
        disabled={isDisabled}
        setValue={(checked) => onToggle(series.seriesId, checked)}
      />
      <Text size="2">{series.label}</Text>
    </Flex>
  );
}

export default function SeriesList({
  block,
  setBlock,
  factTable,
  hasMetricSlicesFeature,
}: SeriesListProps) {
  const [filterInput, setFilterInput] = useState("");
  const { factMetrics } = useDefinitions();
  const metricName =
    factMetrics.find((m) => m.id === block.factMetricId)?.name || "Metric";

  const allSeries = useMemo(() => {
    const series: SeriesInfo[] = [];

    const hasAutoSlices =
      (block.analysisSettings.metricAutoSlices?.length ?? 0) > 0;
    const hasCustomSlices =
      (block.analysisSettings.customMetricSlices?.length ?? 0) > 0;

    // If no slices, return base metric
    if (!hasAutoSlices && !hasCustomSlices) {
      return [
        {
          seriesId: "",
          label: `${metricName} (${block.valueType})`,
          type: "base" as const,
        },
      ];
    }

    if (hasAutoSlices && factTable) {
      block.analysisSettings.metricAutoSlices?.forEach((columnName) => {
        const column = factTable.columns.find((c) => c.column === columnName);
        if (!column?.autoSlices) return;

        column.autoSlices.forEach((level) => {
          const slice = { [columnName]: level };
          const seriesId = formatSliceLabel(slice);

          series.push({
            seriesId,
            label: level || "",
            type: "auto",
            column: columnName,
            level: level || "",
          });
        });
      });
    }

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
        });
      });
    }

    return series;
  }, [
    block.analysisSettings.customMetricSlices,
    block.analysisSettings.metricAutoSlices,
    block.valueType,
    factTable,
    metricName,
  ]);

  // Group series by type
  const baseSeries = allSeries.filter((s) => s.type === "base");
  const autoSeries = allSeries.filter((s) => s.type === "auto");
  const customSeries = allSeries.filter((s) => s.type === "custom");

  // Group auto series by column
  const autoSeriesByColumn = useMemo(() => {
    const grouped = new Map<
      string,
      {
        columnName: string;
        series: SeriesInfo[];
      }
    >();

    autoSeries.forEach((series) => {
      if (!series.column) return;

      if (!grouped.has(series.column)) {
        const columnInfo = factTable?.columns.find(
          (c) => c.column === series.column,
        );
        const columnName = columnInfo?.name || series.column;
        grouped.set(series.column, {
          columnName,
          series: [],
        });
      }
      grouped.get(series.column)!.series.push(series);
    });

    return grouped;
  }, [autoSeries, factTable]);

  // Filter series based on filterSeries input
  const filterLower = filterInput.toLowerCase().trim();
  const hasFilter = filterLower.length > 0;

  // Filter auto series
  const filteredAutoSeries = useMemo(() => {
    if (!hasFilter) return autoSeries;
    return autoSeries.filter((series) => {
      const labelMatch = series.label.toLowerCase().includes(filterLower);
      const seriesIdMatch = series.seriesId.toLowerCase().includes(filterLower);
      // Also check column display name if available
      const columnMatch = series.column
        ? factTable?.columns
            .find((c) => c.column === series.column)
            ?.name?.toLowerCase()
            .includes(filterLower)
        : false;
      return labelMatch || seriesIdMatch || columnMatch;
    });
  }, [autoSeries, filterLower, hasFilter, factTable]);

  // Group filtered auto series by column
  const filteredAutoSeriesByColumn = useMemo(() => {
    const grouped = new Map<
      string,
      {
        columnName: string;
        series: SeriesInfo[];
      }
    >();

    filteredAutoSeries.forEach((series) => {
      if (!series.column) return;

      if (!grouped.has(series.column)) {
        const columnInfo = factTable?.columns.find(
          (c) => c.column === series.column,
        );
        const columnName = columnInfo?.name || series.column;
        grouped.set(series.column, {
          columnName,
          series: [],
        });
      }
      grouped.get(series.column)!.series.push(series);
    });

    return grouped;
  }, [filteredAutoSeries, factTable]);

  // Filter custom series
  const filteredCustomSeries = useMemo(() => {
    if (!hasFilter) return customSeries;
    return customSeries.filter((series) => {
      const labelMatch = series.label.toLowerCase().includes(filterLower);
      const seriesIdMatch = series.seriesId.toLowerCase().includes(filterLower);
      return labelMatch || seriesIdMatch;
    });
  }, [customSeries, filterLower, hasFilter]);

  // Check if a series is enabled (not hidden)
  const isSeriesEnabled = (seriesId: string) => {
    const config = block.displaySettings?.seriesOverrides?.find(
      (c) => c.seriesId === seriesId,
    );
    // Default to shown (not hidden) if no config exists
    return config?.hidden !== true;
  };

  // Disable checkbox if this is the only series (user must show at least one)
  const isOnlySeries = allSeries.length === 1;
  const isDisabled = !hasMetricSlicesFeature || isOnlySeries;

  const handleSeriesToggle = (seriesId: string, checked: boolean) => {
    const currentOverrides = block.displaySettings?.seriesOverrides || [];
    const existingIndex = currentOverrides.findIndex(
      (c) => c.seriesId === seriesId,
    );

    let newOverrides: typeof currentOverrides;
    if (checked) {
      // User wants to show - remove from config if it exists
      if (existingIndex >= 0) {
        newOverrides = currentOverrides.filter((_, i) => i !== existingIndex);
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
        newOverrides = [...currentOverrides, { seriesId, hidden: true }];
      }
    }

    setBlock({
      ...block,
      displaySettings: {
        ...block.displaySettings,
        seriesOverrides:
          newOverrides && newOverrides.length > 0 ? newOverrides : undefined,
      },
    });
  };

  const handleSelectOrDeselect = (enableAll: boolean) => {
    // Use filtered series if filter is active, otherwise use all series
    const seriesToAffect = hasFilter
      ? [...filteredAutoSeries, ...filteredCustomSeries]
      : [...autoSeries, ...customSeries];

    const selectableSeriesIds = seriesToAffect.map((s) => s.seriesId);

    const currentOverrides = block.displaySettings?.seriesOverrides || [];
    const existingOverrides = currentOverrides.filter(
      (o) => !selectableSeriesIds.includes(o.seriesId),
    );

    const newOverrides = enableAll
      ? existingOverrides.length > 0
        ? existingOverrides
        : undefined
      : [
          ...existingOverrides,
          ...selectableSeriesIds.map((seriesId) => ({
            seriesId,
            hidden: true,
          })),
        ];

    setBlock({
      ...block,
      displaySettings: {
        ...block.displaySettings,
        seriesOverrides:
          newOverrides && newOverrides.length > 0 ? newOverrides : undefined,
      },
    });
  };

  // Calculate counts - use filtered series if filter is active
  const seriesToCount = hasFilter
    ? [...filteredAutoSeries, ...filteredCustomSeries]
    : [...autoSeries, ...customSeries];
  const totalSeriesCount = hasFilter
    ? seriesToCount.length
    : autoSeries.length + customSeries.length;
  const numOfSeriesHidden =
    block.displaySettings?.seriesOverrides?.filter((s) =>
      seriesToCount.some((series) => series.seriesId === s.seriesId),
    ).length || 0;
  const numOfSelectedSeries = totalSeriesCount - numOfSeriesHidden;

  return (
    <div>
      <Flex align="center" gap="1" mb="2">
        <Text as="label" style={{ margin: 0 }}>
          Series
        </Text>
        <Tooltip
          body="Series are the individual lines that make up the chart. You can customize which series are displayed on the chart by selecting or deselecting them here."
          className="d-inline-flex"
          style={{ verticalAlign: "middle" }}
        />
      </Flex>
      <Text as="p" className="mb-2" style={{ color: "var(--color-text-mid)" }}>
        Customize which series are displayed on the chart.
      </Text>
      {autoSeriesByColumn.size > 0 || customSeries.length > 0 ? (
        <>
          <Flex align="center" gap="2" mb="2">
            <TextField.Root
              size="2"
              type="search"
              placeholder="Search..."
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              style={{ flex: 1 }}
            >
              <TextField.Slot>
                <PiMagnifyingGlass size={16} style={{ marginLeft: "4px" }} />
              </TextField.Slot>
            </TextField.Root>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasFilter}
              onClick={() => setFilterInput("")}
              style={{ marginTop: "20px" }}
            >
              Clear
            </Button>
          </Flex>
          <Flex align="center" gap="2" mb="2" justify="between">
            <Text size="2" weight="light">
              {numOfSelectedSeries} of {totalSeriesCount} selected
              {hasFilter && " (filtered)"}
            </Text>
            <Flex align="center" justify="end" gap="2">
              <Button
                variant="ghost"
                size="xs"
                disabled={isDisabled}
                onClick={() => handleSelectOrDeselect(true)}
              >
                {hasFilter ? "Select All Filtered" : "Select All"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={isDisabled}
                onClick={() => handleSelectOrDeselect(false)}
              >
                {hasFilter ? "Deselect All Filtered" : "Deselect All"}
              </Button>
            </Flex>
          </Flex>
          {filteredAutoSeriesByColumn.size === 0 &&
          filteredCustomSeries.length === 0 &&
          hasFilter ? (
            <Text size="2" style={{ color: "var(--color-text-mid)" }}>
              No series found that match your search.
            </Text>
          ) : (
            <>
              {Array.from(filteredAutoSeriesByColumn.entries())
                .sort((a, b) => a[1].columnName.localeCompare(b[1].columnName))
                .map(([column, { columnName, series: columnSeries }]) => (
                  <Box key={column} pb="2">
                    <Collapsible
                      open={true}
                      trigger={
                        <Flex
                          align="center"
                          justify="between"
                          style={{
                            paddingLeft: "4px",
                            paddingRight: "4px",
                            paddingTop: "4px",
                            paddingBottom: "4px",
                            cursor: "pointer",
                          }}
                        >
                          <Text
                            size="2"
                            weight="medium"
                            style={{
                              color: "var(--color-text-mid)",
                            }}
                          >
                            {columnName}
                          </Text>
                          <FaAngleRight className="chevron" />
                        </Flex>
                      }
                      transitionTime={100}
                    >
                      <Flex
                        direction="column"
                        gap="1"
                        style={{ paddingLeft: "16px", paddingTop: "4px" }}
                      >
                        {columnSeries
                          .sort((a, b) =>
                            (a.level || "").localeCompare(b.level || ""),
                          )
                          .map((series) => (
                            <SeriesCheckbox
                              key={series.seriesId}
                              series={series}
                              isEnabled={isSeriesEnabled(series.seriesId)}
                              isDisabled={isDisabled}
                              onToggle={handleSeriesToggle}
                            />
                          ))}
                      </Flex>
                    </Collapsible>
                  </Box>
                ))}
              {filteredCustomSeries.length > 0 && (
                <Collapsible
                  open={true}
                  trigger={
                    <Flex
                      align="center"
                      justify="between"
                      style={{
                        paddingLeft: "4px",
                        paddingRight: "4px",
                        paddingTop: "4px",
                        paddingBottom: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <Text
                        size="2"
                        weight="medium"
                        style={{
                          color: "var(--color-text-mid)",
                        }}
                      >
                        Custom Slice{filteredCustomSeries.length > 1 ? "s" : ""}
                      </Text>
                      <FaAngleRight className="chevron" />
                    </Flex>
                  }
                  transitionTime={100}
                >
                  <Flex
                    direction="column"
                    gap="1"
                    style={{ paddingLeft: "16px", paddingTop: "4px" }}
                  >
                    {filteredCustomSeries.map((series) => (
                      <SeriesCheckbox
                        key={series.seriesId}
                        series={series}
                        isEnabled={isSeriesEnabled(series.seriesId)}
                        isDisabled={isDisabled}
                        onToggle={handleSeriesToggle}
                      />
                    ))}
                  </Flex>
                </Collapsible>
              )}
            </>
          )}
        </>
      ) : (
        baseSeries.map((series) => (
          <SeriesCheckbox
            key={series.seriesId}
            series={series}
            isEnabled={isSeriesEnabled(series.seriesId)}
            isDisabled={isDisabled}
            onToggle={handleSeriesToggle}
          />
        ))
      )}
    </div>
  );
}
