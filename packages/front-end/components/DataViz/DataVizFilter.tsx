import {
  FilterConfiguration,
  DataVizConfig,
} from "back-end/src/validators/saved-queries";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
import { Select, SelectItem } from "@/components/Radix/Select";
import Button from "../Radix/Button";
import MultiSelectField from "../Forms/MultiSelectField";
import { ColumnFilterOption } from "./DataVizFilterPanel";

type Props = {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
  columnFilterOptions: ColumnFilterOption[];
  filterIndex: number;
  rows?: Record<string, unknown>[];
};

function getUniqueValuesFromColumn(
  rows: Record<string, unknown>[],
  columnName: string,
): string[] {
  const uniqueValues = new Set<string>();

  rows.forEach((row) => {
    const value = row[columnName];
    if (value != null) {
      uniqueValues.add(String(value));
    }
  });

  return Array.from(uniqueValues);
}

const filterOptions = [
  // Date filters
  { value: "today", label: "Today", supportedTypes: ["date"] },
  { value: "last7Days", label: "Last 7 Days", supportedTypes: ["date"] },
  { value: "last30Days", label: "Last 30 Days", supportedTypes: ["date"] },
  { value: "dateRange", label: "Custom Date Range", supportedTypes: ["date"] },

  // Number filters
  { value: "numberRange", label: "Custom Range", supportedTypes: ["number"] },
  { value: "greaterThan", label: "Greater Than", supportedTypes: ["number"] },
  {
    value: "greaterThanOrEqualTo",
    label: "Greater Than or Equal To",
    supportedTypes: ["number"],
  },
  { value: "lessThan", label: "Less Than", supportedTypes: ["number"] },
  {
    value: "lessThanOrEqualTo",
    label: "Less Than or Equal To",
    supportedTypes: ["number"],
  },
  { value: "equalTo", label: "Equals", supportedTypes: ["number"] },

  // String filters
  { value: "includes", label: "Select Values", supportedTypes: ["string"] },
  { value: "contains", label: "Text Search", supportedTypes: ["string"] },
];

export default function DataVizFilter({
  filterIndex,
  dataVizConfig,
  onDataVizConfigChange,
  rows,
  columnFilterOptions,
}: Props) {
  const filters = dataVizConfig.filters || [];

  const updateFilter = (newFilter: FilterConfiguration) => {
    const newFilters = [...filters];
    newFilters[filterIndex] = newFilter;
    onDataVizConfigChange({
      ...dataVizConfig,
      filters: newFilters,
    });
  };

  const updateFilterConfig = (
    configUpdates: Record<string, string | number | string[] | undefined>,
  ) => {
    const currentFilter = filters[filterIndex];
    const currentConfig = currentFilter?.config || {};

    // Handle undefined values by deleting the key
    const newConfig = { ...currentConfig };
    Object.entries(configUpdates).forEach(([key, value]) => {
      if (value === undefined) {
        delete newConfig[key];
      } else {
        newConfig[key] = value;
      }
    });

    // Create updated filter with new config, maintaining discriminated union structure
    const updatedFilter: FilterConfiguration = {
      ...currentFilter,
      config: newConfig,
    } as FilterConfiguration;

    updateFilter(updatedFilter);
  };

  const removeFilter = () => {
    const newFilters = [...filters];
    newFilters.splice(filterIndex, 1);
    onDataVizConfigChange({
      ...dataVizConfig,
      filters: newFilters,
    });
  };

  const createDefaultFilterForType = (
    column: string,
    type: "string" | "number" | "date",
  ): FilterConfiguration => {
    if (type === "date") {
      // Default to last 30 days for date filters
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      return {
        column,
        type: "date",
        filterType: "dateRange",
        config: {
          startDate: thirtyDaysAgo.toISOString().split("T")[0], // YYYY-MM-DD format
          endDate: today.toISOString().split("T")[0],
        },
      };
    } else if (type === "number") {
      return {
        column,
        type: "number",
        filterType: "equalTo",
        config: { value: "0" }, // Store as string initially to match schema
      };
    } else {
      return {
        column,
        type: "string",
        filterType: "contains",
        config: { value: "" },
      };
    }
  };

  const changeFilterType = (newFilterType: string) => {
    const currentFilter = filters[filterIndex];

    if (currentFilter.type === "date") {
      if (newFilterType === "dateRange") {
        // Calculate last 30 days as default
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);

        updateFilter({
          column: currentFilter.column,
          type: "date",
          filterType: "dateRange",
          config: {
            startDate: thirtyDaysAgo.toISOString().split("T")[0], // YYYY-MM-DD format
            endDate: today.toISOString().split("T")[0],
          },
        });
      } else {
        updateFilter({
          column: currentFilter.column,
          type: "date",
          filterType: newFilterType as "today" | "last7Days" | "last30Days",
          config: {},
        });
      }
    } else if (currentFilter.type === "number") {
      if (newFilterType === "numberRange") {
        updateFilter({
          column: currentFilter.column,
          type: "number",
          filterType: "numberRange",
          config: { min: "0", max: "100" },
        });
      } else {
        updateFilter({
          column: currentFilter.column,
          type: "number",
          filterType: newFilterType as
            | "greaterThan"
            | "lessThan"
            | "equalTo"
            | "greaterThanOrEqualTo"
            | "lessThanOrEqualTo",
          config: { value: "0" },
        });
      }
    } else if (currentFilter.type === "string") {
      if (newFilterType === "includes") {
        updateFilter({
          column: currentFilter.column,
          type: "string",
          filterType: "includes",
          config: { values: [] },
        });
      } else {
        updateFilter({
          column: currentFilter.column,
          type: "string",
          filterType: "contains",
          config: { value: "" },
        });
      }
    }
  };

  return (
    <>
      {filterIndex > 0 && <Separator size="4" mt="2" />}
      <Flex direction="column" gap="4">
        <Select
          label={
            <Flex justify="between" align="center">
              <Text as="label">Filter {filterIndex + 1}</Text>
              <Box mb="2">
                <Button variant="ghost" color="red" onClick={removeFilter}>
                  <PiTrash />
                </Button>
              </Box>
            </Flex>
          }
          value={filters[filterIndex].column}
          setValue={(v) => {
            const { knownType } = columnFilterOptions.find(
              (option) => option.column === v,
            ) || { knownType: "string" };

            // When the column changes, create a completely new filter
            const newFilter = createDefaultFilterForType(v, knownType);
            updateFilter(newFilter);
          }}
          size="2"
          placeholder="Select a column to filter by"
        >
          {columnFilterOptions.map((option, i) => (
            <SelectItem key={`${option.column}-${i}`} value={option.column}>
              {option.column}
            </SelectItem>
          ))}
        </Select>

        <Flex direction="row" justify="between" align="center">
          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
            Type
          </Text>
          <Select
            style={{ flex: 1 }}
            value={filters[filterIndex].type}
            setValue={(v) => {
              if (!v) return;
              if (!["string", "number", "date"].includes(v)) {
                throw new Error(`Invalid filter type: ${v}`);
              }

              const currentFilter = filters[filterIndex];
              const newFilter = createDefaultFilterForType(
                currentFilter.column,
                v as "string" | "number" | "date",
              );
              updateFilter(newFilter);
            }}
            size="2"
            placeholder="Select type"
          >
            <SelectItem value="string">String</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="date">Date</SelectItem>
          </Select>
        </Flex>

        <Flex direction="row" justify="between" align="center">
          <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
            Filter Options
          </Text>
          <Select
            style={{ flex: 1 }}
            size="2"
            placeholder="Select Option"
            value={filters[filterIndex].filterType || ""}
            setValue={(v) => {
              if (!v) return;
              changeFilterType(v);
            }}
          >
            {filterOptions
              .filter(
                (filterOption) =>
                  filters[filterIndex].type &&
                  filterOption.supportedTypes.includes(
                    filters[filterIndex].type,
                  ),
              )
              .map((filterOption) => (
                <SelectItem key={filterOption.value} value={filterOption.value}>
                  {filterOption.label}
                </SelectItem>
              ))}
          </Select>
        </Flex>

        {/* Number Range Inputs */}
        {filters[filterIndex].type === "number" &&
          filters[filterIndex].filterType === "numberRange" && (
            <>
              <Flex direction="row" justify="between" align="center">
                <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                  Min Value
                </Text>
                <TextField.Root
                  style={{ flex: 1 }}
                  size="2"
                  type="number"
                  placeholder="Minimum"
                  required
                  value={filters[filterIndex].config?.min?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value || "";
                    updateFilterConfig({ min: value });
                  }}
                />
              </Flex>
              <Flex direction="row" justify="between" align="center">
                <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                  Max Value
                </Text>
                <TextField.Root
                  style={{ flex: 1 }}
                  size="2"
                  type="number"
                  placeholder="Maximum"
                  required
                  value={filters[filterIndex].config?.max?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value || "";
                    updateFilterConfig({ max: value });
                  }}
                />
              </Flex>
            </>
          )}

        {/* Single Number Value Input */}
        {filters[filterIndex].type === "number" &&
          (filters[filterIndex].filterType === "greaterThan" ||
            filters[filterIndex].filterType === "greaterThanOrEqualTo" ||
            filters[filterIndex].filterType === "lessThan" ||
            filters[filterIndex].filterType === "lessThanOrEqualTo" ||
            filters[filterIndex].filterType === "equalTo") && (
            <Flex direction="row" justify="between" align="center">
              <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                Value
              </Text>
              <TextField.Root
                style={{ flex: 1 }}
                size="2"
                type="number"
                placeholder="Enter value"
                required
                value={filters[filterIndex].config?.value?.toString() || ""}
                onChange={(e) => {
                  const value = e.target.value || "";
                  updateFilterConfig({ value });
                }}
              />
            </Flex>
          )}

        {/* String Contains Input */}
        {filters[filterIndex].type === "string" &&
          filters[filterIndex].filterType === "contains" && (
            <Flex direction="row" justify="between" align="center">
              <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                Search Text
              </Text>
              <TextField.Root
                style={{ flex: 1 }}
                size="2"
                type="text"
                placeholder="Enter text to search for"
                required
                value={String(filters[filterIndex].config?.value || "")}
                onChange={(e) => {
                  const value = e.target.value || "";
                  updateFilterConfig({ value });
                }}
              />
            </Flex>
          )}

        {/* String Multi-Select */}
        {filters[filterIndex].type === "string" &&
          filters[filterIndex].filterType === "includes" &&
          rows && (
            <MultiSelectField
              label={
                <Text as="label" weight="regular">
                  Select Values
                </Text>
              }
              closeMenuOnSelect={false}
              placeholder="Select values to filter by..."
              value={
                Array.isArray(filters[filterIndex].config?.values)
                  ? filters[filterIndex].config?.values
                  : []
              }
              options={getUniqueValuesFromColumn(
                rows,
                filters[filterIndex].column,
              ).map((value) => ({
                label: value,
                value,
              }))}
              onChange={(values) => {
                updateFilterConfig({ values });
              }}
            />
          )}

        {/* Date Range Inputs */}
        {filters[filterIndex].filterType === "dateRange" && (
          <>
            <Flex direction="row" justify="between" align="center">
              <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                Start
              </Text>
              <TextField.Root
                style={{ flex: 1 }}
                size="2"
                type="date"
                required
                value={String(filters[filterIndex].config?.startDate || "")}
                onChange={(e) => {
                  const value = e.target.value || undefined;
                  updateFilterConfig({ startDate: value });
                }}
              />
            </Flex>
            <Flex direction="row" justify="between" align="center">
              <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                End
              </Text>
              <TextField.Root
                style={{ flex: 1 }}
                size="2"
                type="date"
                required
                value={String(filters[filterIndex].config?.endDate || "")}
                onChange={(e) => {
                  const value = e.target.value || undefined;
                  updateFilterConfig({ endDate: value });
                }}
              />
            </Flex>
          </>
        )}
      </Flex>
    </>
  );
}
