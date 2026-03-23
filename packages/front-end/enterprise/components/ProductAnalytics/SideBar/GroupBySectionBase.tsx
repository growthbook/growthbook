import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiPlus, PiX } from "react-icons/pi";
import { useEffect, useMemo, useRef, useState } from "react";
import Collapsible from "react-collapsible";
import type { ProductAnalyticsDynamicDimension } from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";

type ColumnOption = {
  column: string;
  name?: string | null;
};

type Props = {
  dimensions: ProductAnalyticsDynamicDimension[];
  setDimensions: (dimensions: ProductAnalyticsDynamicDimension[]) => void;
  columns: ColumnOption[];
  maxDimensions: number;
  disableAdd?: boolean;
  title?: string;
};

export default function GroupBySectionBase({
  dimensions,
  setDimensions,
  columns,
  maxDimensions,
  disableAdd = false,
  title = "Group By",
}: Props) {
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(
    Array(dimensions.length).fill(false),
  );
  const [localMaxValues, setLocalMaxValues] = useState<Record<number, string>>(
    {},
  );
  const latestMaxValuesRef = useRef<Record<number, string>>({});
  const skipBlurCommitRef = useRef(false);
  const prevDimensionsLengthRef = useRef(dimensions.length);

  useEffect(() => {
    setAdvancedSettingsOpen((prev) => {
      if (dimensions.length > prev.length) {
        return [...prev, ...Array(dimensions.length - prev.length).fill(false)];
      }
      if (dimensions.length < prev.length) {
        return prev.slice(0, dimensions.length);
      }
      return prev;
    });

    if (dimensions.length < prevDimensionsLengthRef.current) {
      setLocalMaxValues({});
      latestMaxValuesRef.current = {};
    }
    prevDimensionsLengthRef.current = dimensions.length;
  }, [dimensions.length]);

  const availableColumns = useMemo(() => {
    const usedColumns = new Set(
      dimensions.map((d) => d.column).filter((c): c is string => !!c),
    );
    return columns.filter((c) => !usedColumns.has(c.column));
  }, [columns, dimensions]);

  const canAdd =
    !disableAdd &&
    dimensions.length < maxDimensions &&
    availableColumns.length > 0;

  const getColumnOptionsForDimension = (index: number) => {
    const dim = dimensions[index];
    if (!dim) return [];

    const usedByOthers = new Set(
      dimensions
        .map((d, i) => (i !== index ? d.column : null))
        .filter((c): c is string => !!c),
    );

    return columns
      .filter((c) => !usedByOthers.has(c.column) || c.column === dim.column)
      .map((col) => ({ label: col.name || col.column, value: col.column }));
  };

  const handleAddDimension = () => {
    setDimensions([
      ...dimensions,
      {
        dimensionType: "dynamic",
        column: null,
        maxValues: 5,
      },
    ]);
  };

  const handleUpdateDimension = (
    index: number,
    dimension: Partial<ProductAnalyticsDynamicDimension>,
  ) => {
    setDimensions(
      dimensions.map((d, i) => (i === index ? { ...d, ...dimension } : d)),
    );
  };

  const handleRemoveDimension = (index: number) => {
    setAdvancedSettingsOpen((prev) => prev.filter((_, i) => i !== index));
    setDimensions(dimensions.filter((_, i) => i !== index));
  };

  const commitMaxValues = (index: number, value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    const isValid =
      parsed !== null && parsed >= 1 && parsed <= 20 && !isNaN(parsed);

    if (!isValid) {
      setLocalMaxValues((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      delete latestMaxValuesRef.current[index];
      return;
    }

    handleUpdateDimension(index, { maxValues: parsed });
    setLocalMaxValues((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    delete latestMaxValuesRef.current[index];
  };

  return (
    <Flex
      direction="column"
      gap="2"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Text weight="medium">{title}</Text>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={!canAdd}
          onClick={handleAddDimension}
        >
          <Flex align="center" gap="2">
            <PiPlus size={14} /> Add
          </Flex>
        </Button>
      </Flex>
      {dimensions.map((dim, i) => {
        return (
          <Flex
            key={`group-by-dim-${i}`}
            direction="column"
            gap="0"
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-3)",
              padding: "var(--space-2)",
              backgroundColor: "var(--color-panel-translucent)",
            }}
          >
            <Flex direction="row" gap="2" align="center">
              <SelectField
                containerStyle={{ flex: 1, minWidth: 0 }}
                value={dim.column || ""}
                onChange={(val) =>
                  handleUpdateDimension(i, {
                    column: val,
                  })
                }
                options={getColumnOptionsForDimension(i)}
                placeholder="Select dimension..."
                sort={false}
                forceUndefinedValueToNull
              />
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => handleRemoveDimension(i)}
              >
                <PiX size={14} />
              </Button>
            </Flex>

            <Flex direction="row" gap="2" mt="2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  setAdvancedSettingsOpen((prev) => {
                    const next = [...prev];
                    next[i] = !next[i];
                    return next;
                  })
                }
              >
                <Flex direction="row" gap="2" align="center">
                  {advancedSettingsOpen[i] ? (
                    <PiCaretDown size={14} />
                  ) : (
                    <PiCaretRight size={14} />
                  )}
                  <Text size="small" weight="medium">
                    Advanced Options
                  </Text>
                </Flex>
              </Button>
            </Flex>
            <Collapsible
              transitionTime={100}
              open={advancedSettingsOpen[i]}
              trigger=""
              triggerDisabled
            >
              <Flex direction="column" gap="2" mt="1">
                <Text size="small" weight="semibold">
                  Max values
                </Text>
                <Field
                  type="number"
                  min="1"
                  max="20"
                  value={
                    localMaxValues[i] !== undefined
                      ? localMaxValues[i]
                      : dim.maxValues.toString()
                  }
                  onFocus={() => {
                    latestMaxValuesRef.current[i] = dim.maxValues.toString();
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    latestMaxValuesRef.current[i] = v;
                    setLocalMaxValues((prev) => ({ ...prev, [i]: v }));
                  }}
                  onBlur={() => {
                    if (skipBlurCommitRef.current) {
                      skipBlurCommitRef.current = false;
                      return;
                    }
                    const toCommit =
                      latestMaxValuesRef.current[i] ?? dim.maxValues.toString();
                    commitMaxValues(i, toCommit);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const toCommit =
                        latestMaxValuesRef.current[i] ??
                        dim.maxValues.toString();
                      commitMaxValues(i, toCommit);
                      skipBlurCommitRef.current = true;
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </Flex>
            </Collapsible>
          </Flex>
        );
      })}
    </Flex>
  );
}
