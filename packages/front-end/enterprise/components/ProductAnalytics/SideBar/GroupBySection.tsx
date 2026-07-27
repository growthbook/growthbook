import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiPlus, PiX } from "react-icons/pi";
import { useEffect, useMemo, useRef, useState } from "react";
import Collapsible from "react-collapsible";
import type {
  ProductAnalyticsDimension,
  ProductAnalyticsDynamicDimension,
  ProductAnalyticsStaticDimension,
} from "shared/validators";
import Button from "@/ui/Button";
import {
  getMaxDimensions,
  getColumnTopValues,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/ui/MultiSelectField";

const DEFAULT_MAX_VALUES = 5;
const MAX_PINNED_DIMENSION_VALUES = 20;

type GroupByDimension =
  | ProductAnalyticsDynamicDimension
  | ProductAnalyticsStaticDimension;

function isGroupByDimension(
  dim: ProductAnalyticsDimension,
): dim is GroupByDimension {
  return dim.dimensionType === "dynamic" || dim.dimensionType === "static";
}

// Explicit choice, not inferred from pinned values — one input shows at a
// time, and it scales to future dimension types.
const BREAKDOWN_TYPE_OPTIONS: { label: string; value: "dynamic" | "static" }[] =
  [
    { label: "Top values", value: "dynamic" },
    { label: "Pinned values", value: "static" },
  ];

// Shifts keys above `removedIndex` down by one and drops it, so index-keyed
// maps stay aligned after a splice-out instead of losing other dimensions' state.
function reindexAfterRemoval<T>(
  record: Record<number, T>,
  removedIndex: number,
): Record<number, T> {
  const next: Record<number, T> = {};
  Object.entries(record).forEach(([key, value]) => {
    const idx = Number(key);
    if (idx === removedIndex) return;
    next[idx > removedIndex ? idx - 1 : idx] = value;
  });
  return next;
}

export default function GroupBySection() {
  const { draftExploreState, setDraftExploreState, commonColumns } =
    useExplorerContext();
  const { getFactTableById, getFactMetricById } = useDefinitions();
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(
    Array(draftExploreState.dimensions.length).fill(false),
  );
  const [localMaxValues, setLocalMaxValues] = useState<
    Record<number, string | null>
  >({});
  const latestMaxValuesRef = useRef<Record<number, string>>({});
  const skipBlurCommitRef = useRef(false);
  // True when the last Values selection/paste exceeded the cap, so the
  // field can surface that extras were dropped.
  const [capExceeded, setCapExceeded] = useState<Record<number, boolean>>({});

  // Tracks the length these maps were last synced to; Add/Remove update it
  // directly. A mismatch means something outside those handlers reshaped
  // `dimensions` (e.g. changeChartType) — full reset only then.
  const expectedDimensionsLengthRef = useRef(
    draftExploreState.dimensions.length,
  );
  useEffect(() => {
    if (
      draftExploreState.dimensions.length !==
      expectedDimensionsLengthRef.current
    ) {
      setLocalMaxValues({});
      latestMaxValuesRef.current = {};
      setCapExceeded({});
      expectedDimensionsLengthRef.current = draftExploreState.dimensions.length;
    }
  }, [draftExploreState.dimensions.length]);

  // handleAdd/RemoveDimension already keep this in sync for their own
  // changes. A mismatch means something else reshaped `dimensions` (e.g.
  // changeChartType) — resync then, not on every ordinary Add/Remove.
  useEffect(() => {
    if (advancedSettingsOpen.length !== draftExploreState.dimensions.length) {
      setAdvancedSettingsOpen(
        Array(draftExploreState.dimensions.length).fill(false),
      );
    }
  }, [draftExploreState.dimensions.length, advancedSettingsOpen.length]);

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
    if (!dim || !isGroupByDimension(dim)) return [];
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
    // Appending doesn't shift existing indices — just mark this length
    // change as already accounted for.
    expectedDimensionsLengthRef.current += 1;
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: [
        ...prev.dimensions,
        {
          dimensionType: "dynamic",
          column: null,
          maxValues: DEFAULT_MAX_VALUES,
        },
      ],
    }));
  };

  const handleRemoveDimension = (index: number) => {
    setAdvancedSettingsOpen((prev) => prev.filter((_, i) => i !== index));
    // Splicing shifts later indices down by one — reindex instead of
    // resetting other dimensions' state.
    expectedDimensionsLengthRef.current -= 1;
    setLocalMaxValues((prev) => reindexAfterRemoval(prev, index));
    latestMaxValuesRef.current = reindexAfterRemoval(
      latestMaxValuesRef.current,
      index,
    );
    setCapExceeded((prev) => reindexAfterRemoval(prev, index));
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.filter((_, i) => i !== index),
    }));
  };

  // Keeps the breakdown type (a separate choice) but resets values/maxValues,
  // since those were scoped to the previous column.
  const handleColumnChange = (index: number, column: string) => {
    setCapExceeded((prev) => ({ ...prev, [index]: false }));
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d, i) => {
        if (i !== index || !isGroupByDimension(d)) return d;
        if (d.dimensionType === "static") {
          return { dimensionType: "static", column, values: [] };
        }
        return {
          dimensionType: "dynamic",
          column,
          maxValues: DEFAULT_MAX_VALUES,
        };
      }),
    }));
  };

  // Explicit choice via the selector below, not inferred from pinned values.
  // Switching starts the new type fresh, like a column change.
  const handleDimensionTypeChange = (
    index: number,
    dimensionType: GroupByDimension["dimensionType"],
  ) => {
    setCapExceeded((prev) => ({ ...prev, [index]: false }));
    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d, i) => {
        if (i !== index || !isGroupByDimension(d)) return d;
        if (dimensionType === "static") {
          return {
            dimensionType: "static",
            column: d.column ?? "",
            values: [],
          };
        }
        return {
          dimensionType: "dynamic",
          column: d.column,
          maxValues: DEFAULT_MAX_VALUES,
        };
      }),
    }));
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

    const dim = draftExploreState.dimensions[index];
    if (dim && dim.dimensionType === "dynamic") {
      setDraftExploreState((prev) => ({
        ...prev,
        dimensions: prev.dimensions.map((d, i) =>
          i === index && d.dimensionType === "dynamic"
            ? { ...d, maxValues: parsed }
            : d,
        ),
      }));
    }
    setLocalMaxValues((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    delete latestMaxValuesRef.current[index];
  };

  // Only edits the pinned list — switching type happens via the
  // breakdown-type selector above, not by pinning/clearing values here.
  const handleValuesChange = (index: number, values: string[]) => {
    const capped = values.slice(0, MAX_PINNED_DIMENSION_VALUES);

    setCapExceeded((prev) => ({
      ...prev,
      [index]: values.length > MAX_PINNED_DIMENSION_VALUES,
    }));

    setDraftExploreState((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d, i) =>
        i === index && d.dimensionType === "static"
          ? { ...d, values: capped }
          : d,
      ),
    }));
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
        <Text weight="medium">Group By</Text>
        <Tooltip
          enabled={commonColumns.length === 0}
          content="No group by columns are available."
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={
              getMaxDimensions(draftExploreState.dataset) <=
                draftExploreState.dimensions.length ||
              availableColumns.length === 0 ||
              draftExploreState.chartType === "bigNumber"
            }
            onClick={handleAddDimension}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} /> Add
            </Flex>
          </Button>
        </Tooltip>
      </Flex>
      {/* Display existing dimensions */}
      {draftExploreState.dimensions.map((dim, i) => {
        if (!isGroupByDimension(dim)) return null; // Skip date and slice dimensions for now
        const isStatic = dim.dimensionType === "static";
        const pinnedValues = isStatic ? dim.values : [];
        const valueOptions = getColumnTopValues(
          draftExploreState.dataset,
          dim.column,
          getFactTableById,
          getFactMetricById,
        ).map((v) => ({ label: v, value: v }));

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
                size="small"
                containerStyle={{ flex: 1, minWidth: 0 }}
                value={dim.column || ""}
                onChange={(val) => handleColumnChange(i, val)}
                options={getColumnOptionsForDimension(i)}
                placeholder="Select dimension..."
                sort={false}
                forceUndefinedValueToNull
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemoveDimension(i)}
              >
                <PiX size={14} />
              </Button>
            </Flex>

            <Flex direction="row" gap="2" mt="2">
              <Button
                size="sm"
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
                  <Text size="sm" weight="medium">
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
                <Tooltip enabled={!dim.column} content="Select a column first.">
                  <Flex direction="column" gap="2">
                    <SelectField
                      label="Breakdown type"
                      size="small"
                      disabled={!dim.column}
                      value={dim.dimensionType}
                      onChange={(val) =>
                        handleDimensionTypeChange(
                          i,
                          val as GroupByDimension["dimensionType"],
                        )
                      }
                      options={BREAKDOWN_TYPE_OPTIONS}
                      sort={false}
                    />
                  </Flex>
                </Tooltip>

                {!isStatic && (
                  <Field
                    label="Max values"
                    size="md"
                    type="number"
                    min="1"
                    max="20"
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
                        latestMaxValuesRef.current[i] ??
                        dim.maxValues.toString();
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
                )}

                {isStatic && (
                  <MultiSelectField
                    label="Values"
                    size="md"
                    value={pinnedValues}
                    onChange={(v) => handleValuesChange(i, v)}
                    options={valueOptions}
                    creatable
                    sort={false}
                    placeholder="Pin specific values..."
                    helpText={`Pin specific values to break out (max ${MAX_PINNED_DIMENSION_VALUES}).`}
                    error={
                      capExceeded[i]
                        ? `Only the first ${MAX_PINNED_DIMENSION_VALUES} values were kept — the rest were discarded.`
                        : undefined
                    }
                    errorLevel="warning"
                  />
                )}
              </Flex>
            </Collapsible>
          </Flex>
        );
      })}
    </Flex>
  );
}
