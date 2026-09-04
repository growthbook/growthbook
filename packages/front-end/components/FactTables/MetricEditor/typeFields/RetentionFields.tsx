import { Flex } from "@radix-ui/themes";
import {
  FactTableDefinition,
  MetricWindowSettings,
} from "shared/types/fact-table";
import RadioGroup from "@/ui/RadioGroup";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import {
  onRetentionDelayOrModeChange,
  retentionModeFromWindow,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";
import { ThresholdBasisRow, ThresholdBasisValue } from "./ThresholdBasisRow";

const UNIT_OPTIONS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
];

// Window row reads as a sentence (spec): Mode, delay, optional "and" + end,
// ONE unit governing both values, "after exposure". Threshold is optional -
// same ONE-row shape/column/comparison as the standalone Threshold type,
// reused via ThresholdBasisRow.
export default function RetentionFields({
  windowSettings,
  onWindowSettingsChange,
  threshold,
  onThresholdChange,
  factTable,
}: {
  windowSettings: MetricWindowSettings;
  onWindowSettingsChange: (value: MetricWindowSettings) => void;
  threshold: ThresholdBasisValue;
  onThresholdChange: (value: ThresholdBasisValue) => void;
  factTable: FactTableDefinition | null;
}) {
  const mode = retentionModeFromWindow(windowSettings);
  const hasThreshold = !!threshold.aggregateFilterColumn;

  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" align="center" wrap="wrap">
        <RadioGroup
          value={mode}
          setValue={(value) =>
            onWindowSettingsChange(
              onRetentionDelayOrModeChange(windowSettings, {
                type: "mode",
                value: value as "starting" | "between",
              }),
            )
          }
          options={[
            { value: "starting", label: "Starting" },
            { value: "between", label: "Between" },
          ]}
        />
        <Text size="sm">Event must occur</Text>
        <TextField
          aria-label="Delay value"
          type="number"
          style={{ width: 70 }}
          value={windowSettings.delayValue}
          onChange={(e) =>
            onWindowSettingsChange(
              onRetentionDelayOrModeChange(windowSettings, {
                type: "delay",
                value: Number(e.target.value),
              }),
            )
          }
        />
        {mode === "between" && (
          <>
            <Text size="sm">and</Text>
            <TextField
              aria-label="End value"
              type="number"
              style={{ width: 70 }}
              value={windowSettings.delayValue + windowSettings.windowValue}
              onChange={(e) =>
                onWindowSettingsChange(
                  onRetentionDelayOrModeChange(windowSettings, {
                    type: "end",
                    value: Number(e.target.value),
                  }),
                )
              }
            />
          </>
        )}
        <Select
          value={windowSettings.delayUnit}
          setValue={(unit) =>
            onWindowSettingsChange({
              ...windowSettings,
              delayUnit: unit as MetricWindowSettings["delayUnit"],
              windowUnit: unit as MetricWindowSettings["windowUnit"],
            })
          }
        >
          {UNIT_OPTIONS.map((u) => (
            <SelectItem key={u.value} value={u.value}>
              {u.label}
            </SelectItem>
          ))}
        </Select>
        <Text size="sm">after exposure</Text>
      </Flex>

      <Switch
        label="Require a minimum amount (Threshold)"
        value={hasThreshold}
        onChange={(checked) =>
          onThresholdChange(
            checked
              ? { aggregateFilterColumn: "$$count", aggregateFilter: "" }
              : {},
          )
        }
      />
      {hasThreshold && (
        <ThresholdBasisRow
          value={threshold}
          onChange={onThresholdChange}
          factTable={factTable}
        />
      )}
    </Flex>
  );
}
