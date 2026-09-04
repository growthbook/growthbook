import { useMemo } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiEye, PiEyeSlash, PiPlus } from "react-icons/pi";
import clsx from "clsx";
import type { SqlValue } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import {
  generateUniqueValueName,
  getValueTypeLabel,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import TimestampColumnSelector from "./TimestampColumnSelector";
import ValueCard from "./ValueCard";
import styles from "./SqlTabContent.module.scss";

const VALUE_TYPE_OPTIONS: {
  value: "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
];

export default function SqlTabContent() {
  const {
    draftExploreState,
    addValueToDataset,
    updateValueInDataset,
    updateTimestampColumn,
    setDraftExploreState,
  } = useExplorerContext();

  const dataset =
    draftExploreState.dataset?.type === "sql"
      ? draftExploreState.dataset
      : null;
  const values: SqlValue[] = dataset?.values || [];
  const isRawTable = draftExploreState.chartType === "rawTable";

  const columnOptions = useMemo(() => {
    return Object.entries(dataset?.columnTypes ?? {}).map(([name]) => ({
      label: name,
      value: name,
    }));
  }, [dataset?.columnTypes]);

  const visibleColumnCount = columnOptions.filter(
    ({ value }) => !dataset?.hiddenColumns?.includes(value),
  ).length;

  const timestampOptions = useMemo(() => {
    return Object.entries(dataset?.columnTypes ?? {})
      .filter(([, type]) => type === "date")
      .map(([column]) => ({
        label: column,
        value: column,
      }));
  }, [dataset?.columnTypes]);

  return (
    <Flex direction="column" gap="2">
      <Flex
        width="100%"
        direction="column"
        p="3"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <TimestampColumnSelector
          timestampColumn={dataset?.timestampColumn ?? null}
          columns={timestampOptions.map(({ value }) => value)}
          onChange={updateTimestampColumn}
          allowNone
          selectTooltip={
            timestampOptions.length === 0
              ? isRawTable
                ? "Update your SQL query to return a date or timestamp column to filter by date."
                : "Update your SQL query to return a date or timestamp column to use date filtering, comparisons, and time-series charts."
              : isRawTable
                ? "Selecting a timestamp column enables date filtering."
                : "Selecting a timestamp column enables date filtering, comparisons, and time-series charts."
          }
        />
      </Flex>
      {isRawTable && columnOptions.length > 0 ? (
        <Flex
          width="100%"
          direction="column"
          p="3"
          gap="3"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <Text weight="medium">Configure Columns</Text>
          <Flex direction="column" gap="1" width="100%">
            {columnOptions.map(({ value, label }) => {
              const isVisible = !dataset?.hiddenColumns?.includes(value);
              const isLastVisible = isVisible && visibleColumnCount === 1;
              const toggleLabel = isVisible ? "Hide column" : "Show column";
              return (
                <button
                  key={value}
                  type="button"
                  className={styles.columnRow}
                  disabled={isLastVisible}
                  aria-pressed={isVisible}
                  aria-label={toggleLabel}
                  onClick={() => {
                    setDraftExploreState((prev) => {
                      if (prev.type !== "sql" || prev.dataset.type !== "sql") {
                        return prev;
                      }
                      const hiddenColumns = new Set(
                        prev.dataset.hiddenColumns ?? [],
                      );
                      if (isVisible) {
                        hiddenColumns.add(value);
                      } else {
                        hiddenColumns.delete(value);
                      }
                      return {
                        ...prev,
                        dataset: {
                          ...prev.dataset,
                          hiddenColumns: Array.from(hiddenColumns),
                        },
                      };
                    });
                  }}
                >
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      as="div"
                      size="sm"
                      color={isVisible ? "text-high" : "text-low"}
                      truncate
                    >
                      {label}
                    </Text>
                  </Box>
                  <span
                    className={clsx(styles.eyeIcon, {
                      [styles.eyeIconHidden]: !isVisible,
                    })}
                  >
                    {isVisible ? <PiEye size={16} /> : <PiEyeSlash size={16} />}
                  </span>
                </button>
              );
            })}
          </Flex>
        </Flex>
      ) : null}
      {!isRawTable ? (
        <>
          <Flex direction="column">
            {columnOptions.length > 0 && !values.length && (
              <Flex
                justify="center"
                align="center"
                height="100%"
                style={{
                  border: "1px solid var(--gray-a3)",
                  borderRadius: "var(--radius-3)",
                  padding: "var(--space-3)",
                  backgroundColor: "var(--color-panel-translucent)",
                  width: "100%",
                }}
              >
                <Text size="sm" color="text-low">
                  Add at least one value to explore
                </Text>
              </Flex>
            )}
          </Flex>
          {columnOptions.length > 0 && (
            <Flex direction="column" gap="4">
              {values.map((v, idx) => (
                <ValueCard key={idx} index={idx}>
                  <Flex direction="column" gap="2">
                    <Separator style={{ width: "100%" }} />
                    <Text weight="medium" mt="2">
                      Value type
                    </Text>
                    <SelectField
                      value={v.valueType}
                      onChange={(val) =>
                        updateValueInDataset(idx, {
                          ...v,
                          valueType: val as "count" | "sum",
                          name: generateUniqueValueName(
                            getValueTypeLabel(val as "count" | "sum"),
                            values,
                          ),
                        } as SqlValue)
                      }
                      options={VALUE_TYPE_OPTIONS}
                      placeholder="Select..."
                    />
                    {v.valueType === "sum" && (
                      <>
                        <Text weight="medium" mt="2">
                          Value column
                        </Text>
                        <SelectField
                          value={v.valueColumn ?? ""}
                          onChange={(val) =>
                            updateValueInDataset(idx, {
                              ...v,
                              valueColumn: val,
                            } as SqlValue)
                          }
                          options={columnOptions}
                          placeholder="Select column..."
                        />
                      </>
                    )}
                  </Flex>
                </ValueCard>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => addValueToDataset("sql")}
              >
                <Flex align="center" gap="2">
                  <PiPlus size={14} />
                  Add value
                </Flex>
              </Button>
            </Flex>
          )}
        </>
      ) : null}
    </Flex>
  );
}
