import { Flex, SegmentedControl } from "@radix-ui/themes";
import { useState } from "react";
import {
  ColumnRef,
  FactTableDefinition,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import { quantileSettingsValidator } from "shared/validators";
import { Select, SelectItem } from "@/ui/Select";
import TextField from "@/ui/TextField";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import DataList from "@/ui/DataList";
import { getPercentileLabel } from "@/services/metrics";
import ShapeSelect from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
  aggregationForShape,
  columnValueLabel,
  onQuantileScopeChange,
  onShapeChange,
  shapeFromColumnRef,
  SHAPES,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";

const QUANTILE_OPTIONS = [
  { value: "0.5", label: "Median (P50)" },
  { value: "0.9", label: "P90" },
  { value: "0.95", label: "P95" },
  { value: "0.99", label: "P99" },
];

const SCOPE_LABELS = { event: "All events", unit: "All units" };

export default function QuantileFields({
  quantileSettings,
  onQuantileSettingsChange,
  numerator,
  onNumeratorChange,
  factTable,
  hasCountDistinctHLL,
  canEdit = true,
}: {
  quantileSettings: MetricQuantileSettings;
  onQuantileSettingsChange: (value: MetricQuantileSettings) => void;
  numerator: ColumnRef;
  onNumeratorChange: (value: ColumnRef) => void;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
  canEdit?: boolean;
}) {
  const scope = quantileSettings.type;
  const shape =
    scope === "unit" ? (shapeFromColumnRef(numerator) ?? "sum") : "sum";
  const isPresetQuantile = QUANTILE_OPTIONS.some(
    (o) => o.value === quantileSettings.quantile + "",
  );
  // Tracked separately from isPresetQuantile so picking "Custom" reveals the
  // input without first mutating quantile to some seed value (matches
  // FactMetricModal's QuantileSelector).
  const [showCustom, setShowCustom] = useState(!isPresetQuantile);
  const isCustomQuantile = showCustom || !isPresetQuantile;

  if (!canEdit) {
    const agg = scope === "unit" ? aggregationForShape(shape) : undefined;
    return (
      <DataList
        maxColumns={1}
        data={[
          { label: "Across", value: SCOPE_LABELS[scope] },
          {
            label: "Value",
            value: columnValueLabel(numerator.column, factTable),
          },
          ...(agg
            ? [{ label: "Per-user aggregation", value: agg.toUpperCase() }]
            : []),
          {
            label: "Percentile",
            value: getPercentileLabel(quantileSettings.quantile),
          },
          {
            label: "Ignore zeros",
            value: quantileSettings.ignoreZeros ? "Yes" : "No",
          },
        ]}
      />
    );
  }

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="1">
        <Text size="sm" weight="semibold">
          Across
        </Text>
        <SegmentedControl.Root
          aria-label="Across"
          style={{ alignSelf: "flex-start" }}
          value={scope}
          onValueChange={(newScope) => {
            if (newScope !== "unit" && newScope !== "event") return;
            onNumeratorChange(
              onQuantileScopeChange(
                numerator,
                newScope,
                factTable,
                hasCountDistinctHLL,
              ),
            );
            onQuantileSettingsChange({ ...quantileSettings, type: newScope });
          }}
        >
          <SegmentedControl.Item value="event">
            All events
          </SegmentedControl.Item>
          <SegmentedControl.Item value="unit">All units</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>

      <Flex gap="2" align="end" wrap="wrap">
        {scope === "unit" && (
          <ShapeSelect
            label="Per-User Aggregation"
            value={shape}
            shapes={SHAPES}
            factTable={factTable}
            hasCountDistinctHLL={hasCountDistinctHLL}
            onChange={(newShape) =>
              onNumeratorChange(
                onShapeChange(
                  numerator,
                  newShape,
                  factTable,
                  hasCountDistinctHLL,
                ),
              )
            }
          />
        )}
        <ColumnSelect
          shape={shape}
          factTable={factTable}
          hasCountDistinctHLL={hasCountDistinctHLL}
          value={numerator.column}
          onChange={(column) => onNumeratorChange({ ...numerator, column })}
        />
      </Flex>

      <Flex gap="2" align="end" wrap="wrap">
        <Select
          label="Percentile"
          value={isCustomQuantile ? "custom" : quantileSettings.quantile + ""}
          setValue={(v) => {
            if (v === "custom") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            onQuantileSettingsChange({
              ...quantileSettings,
              quantile: parseFloat(v),
            });
          }}
        >
          {QUANTILE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom</SelectItem>
        </Select>
        {isCustomQuantile && (
          <TextField
            label="Custom percentile"
            type="number"
            step={0.001}
            min={0.001}
            max={0.999}
            error={
              quantileSettingsValidator.safeParse(quantileSettings).success
                ? undefined
                : "Enter a percentile greater than 0 and less than 1."
            }
            value={quantileSettings.quantile}
            onChange={(e) =>
              onQuantileSettingsChange({
                ...quantileSettings,
                quantile: Number(e.target.value),
              })
            }
            onBlur={(e) => {
              // Common mistake: entering 90 instead of 0.9 (matches
              // FactMetricModal's QuantileSelector).
              const value = Number(e.target.value);
              if (value > 10 && value < 100) {
                onQuantileSettingsChange({
                  ...quantileSettings,
                  quantile: value / 100,
                });
              }
            }}
          />
        )}
        <Checkbox
          label="Ignore zeros"
          weight="regular"
          value={quantileSettings.ignoreZeros}
          setValue={(ignoreZeros) =>
            onQuantileSettingsChange({ ...quantileSettings, ignoreZeros })
          }
        />
      </Flex>
    </Flex>
  );
}
