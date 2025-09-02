import { FilterConfiguration } from "back-end/src/validators/saved-queries";
import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
import { Select, SelectItem } from "@/components/Radix/Select";
import Button from "../Radix/Button";
import MultiSelectField from "../Forms/MultiSelectField";
import { ColumnFilterOption } from "./DataVizFilterPanel";

type Props = {
  filter: FilterConfiguration;
  filterName: string;
  onFilterChange: (filter: FilterConfiguration) => void;
  onFilterRemove: () => void;
  columnFilterOptions: ColumnFilterOption[];
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

export const filterOptions = [
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
  filter,
  filterName,
  onFilterChange,
  onFilterRemove,
  rows,
  columnFilterOptions,
}: Props) {
  const updateFilterConfig = (
    configUpdates: Record<string, string | number | string[] | undefined>,
  ) => {
    const currentConfig = filter?.config || {};

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
      ...filter,
      config: newConfig,
    } as FilterConfiguration;

    onFilterChange(updatedFilter);
  };

  const createFilterConfig = (
    column: string,
    type: FilterConfiguration["type"],
    filterType?: string,
  ): FilterConfiguration => {
    // If no filterType is provided, use defaults based on type
    const effectiveFilterType = filterType || getDefaultFilterTypeForType(type);

    switch (type) {
      case "date": {
        if (effectiveFilterType === "dateRange") {
          // Calculate last 30 days as default
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
        } else {
          return {
            column,
            type: "date",
            filterType: effectiveFilterType as
              | "today"
              | "last7Days"
              | "last30Days",
            config: {},
          };
        }
      }
      case "number": {
        if (effectiveFilterType === "numberRange") {
          return {
            column,
            type: "number",
            filterType: "numberRange",
            config: { min: "0", max: "100" },
          };
        } else {
          return {
            column,
            type: "number",
            filterType: effectiveFilterType as
              | "greaterThan"
              | "lessThan"
              | "equalTo"
              | "greaterThanOrEqualTo"
              | "lessThanOrEqualTo",
            config: { value: "0" }, // Store as string initially to match schema
          };
        }
      }
      case "string": {
        if (effectiveFilterType === "includes") {
          return {
            column,
            type: "string",
            filterType: "includes",
            config: { values: [] },
          };
        } else {
          return {
            column,
            type: "string",
            filterType: "contains",
            config: { value: "" },
          };
        }
      }
      default:
        return type satisfies never;
    }
  };

  const getDefaultFilterTypeForType = (
    type: FilterConfiguration["type"],
  ): string => {
    switch (type) {
      case "date":
        return "dateRange";
      case "number":
        return "greaterThan";
      case "string":
        return "includes";
      default:
        return type satisfies never;
    }
  };

  const changeFilterType = (newFilterType: string) => {
    const newFilter = createFilterConfig(
      filter.column,
      filter.type,
      newFilterType,
    );
    onFilterChange(newFilter);
  };

  const changeColumn = (newColumn: string) => {
    const columnOption = columnFilterOptions.find(
      (option) => option.column === newColumn,
    );
    if (!columnOption) return;

    const newFilter = createFilterConfig(newColumn, columnOption.knownType);
    onFilterChange(newFilter);
  };

  return (
    <>
      {filter.column !== undefined && filter.type !== undefined && (
        <Flex direction="column" gap="2">
          {filter.column !== undefined && (
            <Select
              label={
                <Flex justify="between" align="center">
                  <Text as="label">{filterName}</Text>
                  <Box mb="2">
                    <Button
                      variant="ghost"
                      color="red"
                      onClick={onFilterRemove}
                    >
                      <PiTrash />
                    </Button>
                  </Box>
                </Flex>
              }
              value={filter.column}
              setValue={changeColumn}
              size="2"
              placeholder="Select a column to filter by"
            >
              {columnFilterOptions.map((option, i) => (
                <SelectItem key={`${option.column}-${i}`} value={option.column}>
                  {option.column}
                </SelectItem>
              ))}
            </Select>
          )}

          <Flex direction="row" justify="between" align="center">
            <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
              Type
            </Text>
            <Select
              style={{ flex: 1 }}
              value={filter.type}
              setValue={(v) => {
                if (!v) return;
                const newFilter = createFilterConfig(
                  filter.column || "",
                  v as FilterConfiguration["type"],
                );
                onFilterChange(newFilter);
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
              value={filter.filterType || ""}
              setValue={(v) => {
                if (!v) return;
                changeFilterType(v);
              }}
            >
              {filterOptions
                .filter(
                  (filterOption) =>
                    filter.type &&
                    filterOption.supportedTypes.includes(filter.type),
                )
                .map((filterOption) => (
                  <SelectItem
                    key={filterOption.value}
                    value={filterOption.value}
                  >
                    {filterOption.label}
                  </SelectItem>
                ))}
            </Select>
          </Flex>

          {/* Number Range Inputs */}
          {filter.type === "number" && filter.filterType === "numberRange" && (
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
                  value={filter.config?.min?.toString() || ""}
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
                  value={filter.config?.max?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value || "";
                    updateFilterConfig({ max: value });
                  }}
                />
              </Flex>
            </>
          )}

          {/* Single Number Value Input */}
          {filter.type === "number" &&
            (filter.filterType === "greaterThan" ||
              filter.filterType === "greaterThanOrEqualTo" ||
              filter.filterType === "lessThan" ||
              filter.filterType === "lessThanOrEqualTo" ||
              filter.filterType === "equalTo") && (
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
                  value={filter.config?.value?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value || "";
                    updateFilterConfig({ value });
                  }}
                />
              </Flex>
            )}

          {/* String Contains Input */}
          {filter.type === "string" && filter.filterType === "contains" && (
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
                value={String(filter.config?.value || "")}
                onChange={(e) => {
                  const value = e.target.value || "";
                  updateFilterConfig({ value });
                }}
              />
            </Flex>
          )}

          {/* String Multi-Select */}
          {filter.type === "string" &&
            filter.filterType === "includes" &&
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
                  Array.isArray(filter.config?.values)
                    ? filter.config?.values
                    : []
                }
                options={getUniqueValuesFromColumn(rows, filter.column).map(
                  (value) => ({
                    label: value,
                    value,
                  }),
                )}
                onChange={(values) => {
                  updateFilterConfig({ values });
                }}
              />
            )}

          {/* Date Range Inputs */}
          {filter.filterType === "dateRange" && (
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
                  value={String(filter.config?.startDate || "")}
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
                  value={String(filter.config?.endDate || "")}
                  onChange={(e) => {
                    const value = e.target.value || undefined;
                    updateFilterConfig({ endDate: value });
                  }}
                />
              </Flex>
            </>
          )}
        </Flex>
      )}
    </>
  );
}
