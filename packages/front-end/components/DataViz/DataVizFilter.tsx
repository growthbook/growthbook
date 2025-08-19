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
  { value: "lessThan", label: "Less Than", supportedTypes: ["number"] },
  { value: "equals", label: "Equals", supportedTypes: ["number"] },

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
  const filters = dataVizConfig.filter || [];
  const updateFilter = (updatedFilter: Partial<FilterConfiguration>) => {
    const newFilters = [...filters];
    newFilters[filterIndex] = { ...newFilters[filterIndex], ...updatedFilter };
    onDataVizConfigChange({
      ...dataVizConfig,
      filter: newFilters,
    });
  };

  const updateFilterConfig = (
    configUpdates: Record<string, string | number | string[] | undefined>,
  ) => {
    const currentConfig = filters[filterIndex]?.config || {};
    const newConfig = { ...currentConfig };

    // Handle undefined values by deleting the key
    Object.entries(configUpdates).forEach(([key, value]) => {
      if (value === undefined) {
        delete newConfig[key];
      } else {
        newConfig[key] = value;
      }
    });

    updateFilter({ config: newConfig });
  };

  const removeFilter = () => {
    const newFilters = [...filters];
    newFilters.splice(filterIndex, 1);
    onDataVizConfigChange({
      ...dataVizConfig,
      filter: newFilters,
    });
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

            // When the column changes, we reset the type and filterType fields to their defaults
            // This means that changing from one date column to another date column will reset the whole form
            // Not ideal
            updateFilter({
              column: v,
              type: knownType,
              filterType:
                knownType === "date"
                  ? "today"
                  : knownType === "number"
                    ? "equals"
                    : "contains",
              config: undefined,
            });
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
              updateFilter({
                type: v as "string" | "number" | "date",
              });
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
          {filters[filterIndex].type === "date" ? (
            <>
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
                  updateFilter({
                    filterType: v as FilterConfiguration["filterType"],
                    config: {},
                  });
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
                    <SelectItem
                      key={filterOption.value}
                      value={filterOption.value}
                    >
                      {filterOption.label}
                    </SelectItem>
                  ))}
              </Select>
            </>
          ) : filters[filterIndex].type === "number" ? (
            <>
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
                  updateFilter({
                    filterType: v as FilterConfiguration["filterType"],
                    config: {},
                  });
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
                    <SelectItem
                      key={filterOption.value}
                      value={filterOption.value}
                    >
                      {filterOption.label}
                    </SelectItem>
                  ))}
              </Select>
            </>
          ) : filters[filterIndex].type === "string" ? (
            <>
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
                  updateFilter({
                    filterType: v as FilterConfiguration["filterType"],
                    config: {},
                  });
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
                    <SelectItem
                      key={filterOption.value}
                      value={filterOption.value}
                    >
                      {filterOption.label}
                    </SelectItem>
                  ))}
              </Select>
            </>
          ) : null}
        </Flex>
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
                    const value = e.target.value || undefined;
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
                  required
                  placeholder="Maximum"
                  value={filters[filterIndex].config?.max?.toString() || ""}
                  onChange={(e) => {
                    const value = e.target.value || undefined;
                    updateFilterConfig({ max: value });
                  }}
                />
              </Flex>
            </>
          )}

        {filters[filterIndex].type === "number" &&
          (filters[filterIndex].filterType === "greaterThan" ||
            filters[filterIndex].filterType === "lessThan" ||
            filters[filterIndex].filterType === "equals") && (
            <Flex direction="row" justify="between" align="center">
              <Text as="label" size="2" mr="2" style={{ flex: 1 }}>
                Value
              </Text>
              <TextField.Root
                style={{ flex: 1 }}
                size="2"
                type="number"
                required
                placeholder="Enter value"
                value={filters[filterIndex].config?.value?.toString() || ""}
                onChange={(e) => {
                  const value = e.target.value || undefined;
                  updateFilterConfig({ value });
                }}
              />
            </Flex>
          )}

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
                required
                placeholder="Enter text to search for"
                value={String(filters[filterIndex].config?.value || "")}
                onChange={(e) => {
                  const value = e.target.value || undefined;
                  updateFilterConfig({ value });
                }}
              />
            </Flex>
          )}

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
