import { Box, Flex, Text } from "@radix-ui/themes";
import {
  DataVizConfig,
  FilterConfiguration,
} from "back-end/src/validators/saved-queries";
import { useEffect, useState } from "react";
import { FaPlusCircle } from "react-icons/fa";
import { PiSlidersHorizontal } from "react-icons/pi";
import Badge from "@/components/Radix/Badge";
import { requiresXAxis } from "@/services/dataVizTypeGuards";
import { AreaWithHeader } from "../SchemaBrowser/SqlExplorerModal";
import Button from "../Radix/Button";
import { inferFieldType } from "./DataVizConfigPanel";
import DataVizFilter from "./DataVizFilter";

export type ColumnFilterOption = {
  column: string;
  knownType: "date" | "number" | "string";
};

type Props = {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: DataVizConfig) => void;
  sampleRow: Record<string, unknown>;
  rows?: Record<string, unknown>[];
};

function getColumnFilterOptions(
  dataVizConfig: Partial<DataVizConfig>,
  sampleRow: Record<string, unknown>
) {
  const filterableColumns: ColumnFilterOption[] = [];
  if (requiresXAxis(dataVizConfig) && dataVizConfig.xAxis) {
    if (
      dataVizConfig.xAxis?.type === "date" ||
      dataVizConfig.xAxis?.type === "number"
    ) {
      filterableColumns.push({
        column: dataVizConfig.xAxis.fieldName,
        knownType: dataVizConfig.xAxis.type,
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
  sampleRow,
  rows,
}: Props) {
  const [columnFilterOptions, setColumnFilterOptions] = useState<
    ColumnFilterOption[]
  >(() => getColumnFilterOptions(dataVizConfig, sampleRow));
  const [dirty, setDirty] = useState(false);
  const [filters, setFilters] = useState<FilterConfiguration[]>(
    dataVizConfig.filter || []
  );

  useEffect(() => {
    const columnFilterOptions = getColumnFilterOptions(
      dataVizConfig,
      sampleRow
    );
    setColumnFilterOptions(columnFilterOptions);
  }, [dataVizConfig, sampleRow]);

  // Early return if no column filter options are available
  if (!columnFilterOptions.length) return null;

  if (!dataVizConfig.chartType) return null;

  return (
    <AreaWithHeader
      header={
        <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
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
        </Text>
      }
    >
      <Box p="4" height="fit-content">
        <Flex direction="column" gap="4">
          {filters.length > 0 &&
            filters.map((filter, index) => {
              return (
                <DataVizFilter
                  key={index}
                  filterIndex={index}
                  columnFilterOptions={columnFilterOptions}
                  filters={filters}
                  setFilters={setFilters}
                  setDirty={setDirty}
                  rows={rows}
                />
              );
            })}
          <a
            role="button"
            className="d-inline-block link-purple font-weight-bold"
            onClick={() => {
              setDirty(true);
              // I need to get the first column filter option
              const firstColumnFilterOption = columnFilterOptions[0];
              const type = firstColumnFilterOption.knownType;
              // Add new filter with default values
              setFilters([
                ...filters,
                {
                  column: firstColumnFilterOption.column,
                  type,
                  filterType:
                    type === "date"
                      ? "today"
                      : type === "number"
                      ? "equals"
                      : "contains",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add Filter
          </a>

          <Flex direction="column" gap="2">
            <Button
              variant="solid"
              disabled={!dirty}
              onClick={() => {
                setDirty(false);

                // Validate each filter has required properties
                filters.forEach((filter, index) => {
                  if (!filter.column) {
                    throw new Error(`Filter ${index + 1} is missing column`);
                  }
                  if (!filter.type) {
                    throw new Error(`Filter ${index + 1} is missing type`);
                  }
                  if (!filter.filterType) {
                    throw new Error(
                      `Filter ${index + 1} is missing filterType`
                    );
                  }
                });

                //MKTODO: Add validation for specific filterTypes
                //E.G. If the filterType is "dateRange" it needs a min/max date
                //E.G. If the filterType is "numberRange" it needs a min/max number
                //E.G. If the filterType is "includes" it needs a list of values
                //E.G. If the filterType is "contains" it needs a string
                //E.G. If the filterType is "equals" it needs a number
                //E.G. If the filterType is "greaterThan" it needs a number
                //E.G. If the filterType is "lessThan" it needs a number
                //E.G. If the filterType is "today" it needs a date

                const newDataVizConfig = {
                  ...dataVizConfig,
                  filter: filters,
                };
                //MKTODO: Is there a way to do this without the type assertion?
                onDataVizConfigChange(newDataVizConfig as DataVizConfig);
              }}
            >
              Apply Filters
            </Button>
          </Flex>
        </Flex>
      </Box>
    </AreaWithHeader>
  );
}
