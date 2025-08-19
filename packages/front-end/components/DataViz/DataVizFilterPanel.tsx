import { Box, Flex, Text } from "@radix-ui/themes";
import {
  DataVizConfig,
  FilterConfiguration,
} from "back-end/src/validators/saved-queries";
import { useEffect, useState } from "react";
import { FaAngleRight, FaPlusCircle } from "react-icons/fa";
import { PiSlidersHorizontal } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Badge from "@/components/Radix/Badge";
import { requiresXAxis } from "@/services/dataVizTypeGuards";
import Button from "../Radix/Button";
import { inferFieldType } from "./DataVizConfigPanel";
import DataVizFilter from "./DataVizFilter";

export type ColumnFilterOption = {
  column: string;
  knownType: "date" | "number" | "string";
};

type Props = {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  sampleRow: Record<string, unknown>;
  rows?: Record<string, unknown>[];
};

function getColumnFilterOptions(
  dataVizConfig: Partial<DataVizConfig>,
  sampleRow: Record<string, unknown>,
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

  useEffect(() => {
    const columnFilterOptions = getColumnFilterOptions(
      dataVizConfig,
      sampleRow,
    );
    setColumnFilterOptions(columnFilterOptions);
  }, [dataVizConfig, sampleRow]);

  const filters = dataVizConfig.filter || [];

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
                          filter: [],
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
              {filters.length > 0 &&
                filters.map((filter, index) => {
                  return (
                    <DataVizFilter
                      key={index}
                      filterIndex={index}
                      columnFilterOptions={columnFilterOptions}
                      dataVizConfig={dataVizConfig}
                      onDataVizConfigChange={onDataVizConfigChange}
                      rows={rows}
                    />
                  );
                })}
              <a
                role="button"
                className="d-inline-block link-purple font-weight-bold"
                onClick={() => {
                  // I need to get the first column filter option
                  const firstColumnFilterOption = columnFilterOptions[0];
                  const type = firstColumnFilterOption.knownType;
                  // Add new filter with default values
                  const newFilter: FilterConfiguration = {
                    column: firstColumnFilterOption.column,
                    type,
                    filterType:
                      type === "date"
                        ? "today"
                        : type === "number"
                          ? "equals"
                          : "contains",
                  };

                  onDataVizConfigChange({
                    ...dataVizConfig,
                    filter: [...filters, newFilter],
                  });
                }}
              >
                <FaPlusCircle className="mr-1" />
                Add Filter
              </a>
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </>
  );
}
