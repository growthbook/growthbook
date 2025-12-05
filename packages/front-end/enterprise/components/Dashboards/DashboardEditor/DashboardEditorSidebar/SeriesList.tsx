import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { FactTableInterface } from "back-end/types/fact-table";
import { Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { formatSliceLabel } from "@/services/dataVizConfigUtilities";

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
  factTable: FactTableInterface | null;
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
          label: "Base", // I think this should actually be the name of the metric
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
  }, [block, factTable]);

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
    const selectableSeriesIds = [...autoSeries, ...customSeries].map(
      (s) => s.seriesId,
    );

    const newOverrides = enableAll
      ? undefined // Select all - no overrides needed (all shown by default)
      : selectableSeriesIds.map((seriesId) => ({ seriesId, hidden: true })); // Deselect all - hide all

    setBlock({
      ...block,
      displaySettings: {
        ...block.displaySettings,
        seriesOverrides: newOverrides,
      },
    });
  };

  const numOfSeriesHidden =
    block.displaySettings?.seriesOverrides?.filter((s) => s.hidden).length || 0;
  const numOfSelectedSeries =
    autoSeries.length + customSeries.length - numOfSeriesHidden;

  // Only show the section if there are series to display
  //MKTODO: Need to think about this
  if (!factTable) {
    return null;
  }

  return (
    <div>
      <Text as="label">Series</Text>
      <Text as="p" className="mb-2" style={{ color: "var(--color-text-mid)" }}>
        Customize which series are displayed on the chart.
      </Text>
      {autoSeriesByColumn.size > 0 || customSeries.length > 0 ? (
        <>
          <Flex align="center" gap="2" mb="2" justify="between">
            <Text size="2" weight="light">
              {numOfSelectedSeries} of {autoSeries.length + customSeries.length}{" "}
              selected
            </Text>
            <Flex align="center" justify="end">
              <Button
                variant="ghost"
                size="xs"
                disabled={isDisabled}
                onClick={() => handleSelectOrDeselect(true)}
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={isDisabled}
                onClick={() => handleSelectOrDeselect(false)}
              >
                Deselect All
              </Button>
            </Flex>
          </Flex>
          {Array.from(autoSeriesByColumn.entries())
            .sort((a, b) => a[1].columnName.localeCompare(b[1].columnName))
            .map(([column, { columnName, series: columnSeries }]) => (
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
              </Flex>
            ))}
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
              <Flex direction="column" gap="1" style={{ paddingLeft: "16px" }}>
                {customSeries.map((series) => (
                  <SeriesCheckbox
                    key={series.seriesId}
                    series={series}
                    isEnabled={isSeriesEnabled(series.seriesId)}
                    isDisabled={isDisabled}
                    onToggle={handleSeriesToggle}
                  />
                ))}
              </Flex>
            </Flex>
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
