import { useMemo } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
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
  } = useExplorerContext();

  const dataset =
    draftExploreState.dataset?.type === "sql"
      ? draftExploreState.dataset
      : null;
  const values: SqlValue[] = dataset?.values || [];

  const columnOptions = useMemo(() => {
    return Object.entries(dataset?.columnTypes ?? {}).map(([name]) => ({
      label: name,
      value: name,
    }));
  }, [dataset?.columnTypes]);

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
          timestampColumn={dataset?.timestampColumn ?? ""}
          columns={timestampOptions.map(({ value }) => value)}
          onChange={updateTimestampColumn}
        />
      </Flex>
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
            <Text size="small" color="text-low">
              Add at least one value to chart
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
                        draftExploreState.dataset.values,
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
    </Flex>
  );
}
