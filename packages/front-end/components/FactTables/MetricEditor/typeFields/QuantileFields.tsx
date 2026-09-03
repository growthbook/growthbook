import { Flex } from "@radix-ui/themes";
import {
  ColumnRef,
  FactTableDefinition,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import TextField from "@/ui/TextField";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import ShapeSelect from "@/components/FactTables/MetricEditor/ShapeSelect";
import ColumnSelect from "@/components/FactTables/MetricEditor/ColumnSelect";
import {
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

// Across: 2 radios, 50% each (spec). Unit scope shows an Aggregation
// ShapeSelect; event scope skips it and restricts Column to numeric only -
// onQuantileScopeChange (PR 1) already encodes both refits.
export default function QuantileFields({
  quantileSettings,
  onQuantileSettingsChange,
  numerator,
  onNumeratorChange,
  onScopeChange,
  factTable,
  hasCountDistinctHLL,
}: {
  quantileSettings: MetricQuantileSettings;
  onQuantileSettingsChange: (value: MetricQuantileSettings) => void;
  numerator: ColumnRef;
  onNumeratorChange: (value: ColumnRef) => void;
  // Scope touches both the numerator (refit) and quantileSettings.type
  // together - one callback instead of two, so a caller can't observe (or
  // accidentally introduce) a numerator/settings pair from different scopes.
  onScopeChange: (result: {
    numerator: ColumnRef;
    quantileSettings: MetricQuantileSettings;
  }) => void;
  factTable: FactTableDefinition | null;
  hasCountDistinctHLL: boolean;
}) {
  const scope = quantileSettings.type;
  const shape =
    scope === "unit" ? (shapeFromColumnRef(numerator) ?? "sum") : "sum";
  const isCustomQuantile = !QUANTILE_OPTIONS.some(
    (o) => o.value === quantileSettings.quantile + "",
  );

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="1">
        <Text size="sm" weight="semibold">
          Across
        </Text>
        <RadioGroup
          value={scope}
          setValue={(value) => {
            const newScope = value as "unit" | "event";
            onScopeChange({
              numerator: onQuantileScopeChange(
                numerator,
                newScope,
                factTable,
                hasCountDistinctHLL,
              ),
              quantileSettings: { ...quantileSettings, type: newScope },
            });
          }}
          options={[
            { value: "event", label: "All events" },
            { value: "unit", label: "All units" },
          ]}
        />
      </Flex>

      <Flex gap="2" align="end" wrap="wrap">
        {scope === "unit" && (
          <ShapeSelect
            label="Aggregation"
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
            if (v === "custom") return;
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
            type="number"
            step={0.001}
            min={0.001}
            max={0.999}
            value={quantileSettings.quantile}
            onChange={(e) =>
              onQuantileSettingsChange({
                ...quantileSettings,
                quantile: Number(e.target.value),
              })
            }
          />
        )}
        <Checkbox
          label="Ignore zeros"
          value={quantileSettings.ignoreZeros}
          setValue={(ignoreZeros) =>
            onQuantileSettingsChange({ ...quantileSettings, ignoreZeros })
          }
        />
      </Flex>
    </Flex>
  );
}
