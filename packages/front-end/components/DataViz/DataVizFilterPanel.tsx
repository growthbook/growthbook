import { Box, Flex, Separator, Text } from "@radix-ui/themes";
import { DataVizConfig, FilterConfiguration } from "shared/validators";
import { useEffect, useState } from "react";
import { FaAngleRight, FaPlusCircle } from "react-icons/fa";
import { PiSlidersHorizontal } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Badge from "@/ui/Badge";
import { requiresXAxis } from "@/services/dataVizTypeGuards";
import { getXAxisConfig } from "@/services/dataVizConfigUtilities";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import { inferFieldType } from "./DataVizConfigPanel";
import DataVizFilter from "./DataVizFilter";

export type ColumnFilterOption = {
  column: string;
  knownType: "date" | "number" | "string";
};

type Props = {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  rows: Record<string, unknown>[];
};

function getColumnFilterOptions(
  dataVizConfig: Partial<DataVizConfig>,
  sampleRow: Record<string, unknown>,
) {
  const filterableColumns: ColumnFilterOption[] = [];
  if (requiresXAxis(dataVizConfig)) {
    const xAxisConfigs = getXAxisConfig(dataVizConfig);
    const xConfig = xAxisConfigs[0];
    if (xConfig && (xConfig.type === "date" || xConfig.type === "number")) {
      filterableColumns.push({
        column: xConfig.fieldName,
        knownType: xConfig.type,
      });
    }
  }

  if (
    dataVizConfig.yAxis?.[0]?.type === "date" ||
    dataVizConfig.yAxis?.[0]?.type === "number"
  ) {
    filterableColumns.push({
      column: dataVizConfig.yAxis[0].fieldName,
      knownType: dataVizConfig.yAxis[0].type,
    });
  }

  // Add all columns from sample data (including strings now)
  Object.keys(sampleRow).forEach((sampleRowColumn) => {
    if (
      !filterableColumns.some((column) => column.column === sampleRowColumn)
    ) {
      const inferredType = inferFieldType(sampleRow, sampleRowColumn);
      filterableColumns.push({
        column: sampleRowColumn,
        knownType: inferredType,
      });
    }
  });

  return filterableColumns;
}

export default function DataVizFilterPanel({
  dataVizConfig,
  onDataVizConfigChange,
  rows,
}: Props) {
  const [columnFilterOptions, setColumnFilterOptions] = useState<
    ColumnFilterOption[]
  >(() => getColumnFilterOptions(dataVizConfig, rows[0]));

  useEffect(() => {
    const columnFilterOptions = getColumnFilterOptions(dataVizConfig, rows[0]);
    setColumnFilterOptions(columnFilterOptions);
  }, [dataVizConfig, rows]);

  const filters = dataVizConfig.filters || [];

  // Early return if no column filter options are available
  if (!columnFilterOptions.length) return null;

  if (!dataVizConfig.chartType) return null;

  return (
    <>
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
          open={true}
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
                <Flex justify="between" align="center">
                  <Flex align="center" gap="1">
                    <PiSlidersHorizontal
                      style={{
                        color: "var(--violet-11)",
                      }}
                      size={20}
                    />
                    Filters
                    <Badge
                      label={filters.length.toString()}
                      color="violet"
                      radius="full"
                      variant="soft"
                    />
                  </Flex>
                  <Flex align="center" gap="1">
                    <Button
                      variant="ghost"
                      color="red"
                      disabled={filters.length === 0}
                      onClick={() => {
                        onDataVizConfigChange({
                          ...dataVizConfig,
                          filters: [],
                        });
                      }}
                    >
                      Clear
                    </Button>
                    <FaAngleRight className="chevron" />
                  </Flex>
                </Flex>
              </Text>
            </div>
          }
          transitionTime={100}
        >
          <Box p="4" height="fit-content">
            <Flex direction="column" gap="4">
              {filters.length ? (
                <>
                  {filters.map((filter, index) => {
                    return (
                      <span key={index}>
                        {index > 0 && <Separator size="4" m="2" />}
                        <DataVizFilter
                          filter={filter}
                          filterName={`Filter ${index + 1}`}
                          onFilterChange={(updatedFilter) => {
                            const newFilters = [...filters];
                            newFilters[index] = updatedFilter;
                            onDataVizConfigChange({
                              ...dataVizConfig,
                              filters: newFilters,
                            });
                          }}
                          onFilterRemove={() => {
                            const newFilters = [...filters];
                            newFilters.splice(index, 1);
                            onDataVizConfigChange({
                              ...dataVizConfig,
                              filters: newFilters,
                            });
                          }}
                          columnFilterOptions={columnFilterOptions}
                          rows={rows}
                        />
                      </span>
                    );
                  })}
                </>
              ) : null}
              <Link
                onClick={(e) => {
                  e.preventDefault();

                  // Get the first column filter option
                  const firstColumnFilterOption = columnFilterOptions[0];
                  const type = firstColumnFilterOption.knownType;

                  // Add new filter with default values based on the type
                  let newFilter: FilterConfiguration;

                  if (type === "date") {
                    // Default to last 30 days for date filters
                    const today = new Date();
                    const thirtyDaysAgo = new Date(today);
                    thirtyDaysAgo.setDate(today.getDate() - 30);

                    newFilter = {
                      column: firstColumnFilterOption.column,
                      columnType: "date",
                      filterMethod: "dateRange",
                      config: {
                        startDate: thirtyDaysAgo.toISOString().split("T")[0],
                        endDate: today.toISOString().split("T")[0],
                      },
                    };
                  } else if (type === "number") {
                    newFilter = {
                      column: firstColumnFilterOption.column,
                      columnType: "number",
                      filterMethod: "greaterThan",
                      config: { value: "0" },
                    };
                  } else {
                    newFilter = {
                      column: firstColumnFilterOption.column,
                      columnType: "string",
                      filterMethod: "includes",
                      config: { values: [] },
                    };
                  }

                  onDataVizConfigChange({
                    ...dataVizConfig,
                    filters: [...filters, newFilter],
                  });
                }}
              >
                <FaPlusCircle className="mr-1" />
                <Text as="span" className="font-weight-bold">
                  <Tooltip body="Filters can be used to filter the data returned by the query, before it is aggregated and displayed.">
                    Add Filter
                  </Tooltip>
                </Text>
              </Link>
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </>
  );
}
