import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiPlus, PiX } from "react-icons/pi";
import { useEffect, useMemo, useRef, useState } from "react";
import Collapsible from "react-collapsible";
import Button from "@/ui/Button";
import { getMaxDimensions } from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";

export default function GroupBySection() {
  const { draftExploreState, setDraftExploreState, commonColumns } =
    useExplorerContext();
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(
    Array(draftExploreState.dimensions.length).fill(false),
  );
  const [localMaxValues, setLocalMaxValues] = useState<
    Record<number, string | null>
  >({});
  const latestMaxValuesRef = useRef<Record<number, string>>({});
  const skipBlurCommitRef = useRef(false);

  const prevDimensionsLengthRef = useRef(draftExploreState.dimensions.length);
  useEffect(() => {
    if (draftExploreState.dimensions.length < prevDimensionsLengthRef.current) {
      setLocalMaxValues({});
      latestMaxValuesRef.current = {};
    }
    prevDimensionsLengthRef.current = draftExploreState.dimensions.length;
  }, [draftExploreState.dimensions.length]);

  const availableColumns = useMemo(() => {
    // Filter out columns already used in dimensions
    const usedColumns = new Set(
      draftExploreState.dimensions
        .map((d) => ("column" in d ? d.column : null))
        .filter(Boolean),
    );
    return commonColumns.filter((c) => !usedColumns.has(c.column));
  }, [commonColumns, draftExploreState.dimensions]);

  const getColumnOptionsForDimension = (index: number) => {
    const dim = draftExploreState.dimensions[index];
    if (!dim || dim.dimensionType !== "dynamic" || !("column" in dim))
      return [];
    const usedByOthers = new Set(
      draftExploreState.dimensions
        .map((d, i) => (i !== index && "column" in d ? d.column : null))
        .filter((c): c is string => c !== null),
    );
    return commonColumns
      .filter((c) => !usedByOthers.has(c.column) || c.column === dim.column)
      .map((col) => ({ label: col.name || col.column, value: col.column }));
  };

  const handleAddDimension = () => {
    setAdvancedSettingsOpen((prev) => [...prev, false]); // New dimension defaults to collapsed
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: [
        ...prev.dimensions,
        {
          dimensionType: "dynamic",
          column: availableColumns[0].column,
          maxValues: 5,
        },
      ],
    }));
  };

  const handleUpdateDimension = (
    index: number,
    dimension: { column: string; maxValues: number },
  ) => {
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d, i) =>
        i === index ? { ...d, ...dimension } : d,
      ),
    }));
  };

  const handleRemoveDimension = (index: number) => {
    setAdvancedSettingsOpen((prev) => prev.filter((_, i) => i !== index));
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.filter((_, i) => i !== index),
    }));
  };

  const commitMaxValues = (index: number, value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    const isValid = parsed !== null && parsed >= 1 && !isNaN(parsed);

    if (!isValid) {
      setLocalMaxValues((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      delete latestMaxValuesRef.current[index];
      return;
    }

    const dim = draftExploreState.dimensions[index];
    if (dim && dim.dimensionType === "dynamic") {
      handleUpdateDimension(index, { column: dim.column, maxValues: parsed });
    }
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
        <Text weight="medium">Group by (Dimensions)</Text>
        <Button
          size="xs"
          variant="ghost"
          disabled={
            getMaxDimensions(draftExploreState.dataset) <=
              draftExploreState.dimensions.length ||
            availableColumns.length === 0
          }
          onClick={handleAddDimension}
        >
          <Flex align="center" gap="2">
            <PiPlus size={14} /> Add
          </Flex>
        </Button>
      </Flex>
      {/* Display existing dimensions */}
      {draftExploreState.dimensions.map((dim, i) => {
        if (dim.dimensionType === "date") return null; // Skip date dimension as it's usually handled separately or fixed
        if (dim.dimensionType !== "dynamic") return null; // Skip static and slice dimensions for now
        return (
          <Flex
            key={i}
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
                value={dim.column}
                onChange={(val) =>
                  handleUpdateDimension(i, {
                    column: val,
                    maxValues: dim.maxValues,
                  })
                }
                options={getColumnOptionsForDimension(i)}
                placeholder="Select dimension..."
                sort={false}
              />
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleRemoveDimension(i)}
              >
                <PiX size={14} />
              </Button>
            </Flex>

            <Flex direction="row" gap="2" mt="2">
              <Button
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
                  value={
                    localMaxValues[i] !== undefined &&
                    localMaxValues[i] !== null
                      ? localMaxValues[i]!
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
