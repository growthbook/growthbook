import { Box, Flex } from "@radix-ui/themes";
import {
  FactTableDefinition,
  MetricWindowSettings,
} from "shared/types/fact-table";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import {
  onRetentionDelayOrModeChange,
  retentionEnd,
  normalizeRetentionWindow,
  retentionModeFromWindow,
} from "@/components/FactTables/MetricEditor/metricFormTranslation";
import { ThresholdBasisRow, ThresholdBasisValue } from "./ThresholdBasisRow";

const UNIT_OPTIONS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
];

function retentionWindowProse(windowSettings: MetricWindowSettings): string {
  windowSettings = normalizeRetentionWindow(windowSettings);
  const mode = retentionModeFromWindow(windowSettings);
  if (mode === "starting") {
    return `Starting ${windowSettings.delayValue} ${windowSettings.delayUnit} after exposure`;
  }
  const end = retentionEnd(windowSettings);
  return `Between ${windowSettings.delayValue} and ${end} ${windowSettings.delayUnit} after exposure`;
}

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
  canEdit = true,
}: {
  windowSettings: MetricWindowSettings;
  onWindowSettingsChange: (value: MetricWindowSettings) => void;
  threshold: ThresholdBasisValue;
  onThresholdChange: (value: ThresholdBasisValue) => void;
  factTable: FactTableDefinition | null;
  canEdit?: boolean;
}) {
  windowSettings = normalizeRetentionWindow(windowSettings);
  const mode = retentionModeFromWindow(windowSettings);
  const hasThreshold = !!threshold.aggregateFilterColumn;

  if (!canEdit) {
    return (
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="2">
          <Text weight="semibold">Retention period</Text>
          <Text as="div">{retentionWindowProse(windowSettings)}</Text>
        </Flex>
        {hasThreshold && (
          <ThresholdBasisRow
            value={threshold}
            onChange={onThresholdChange}
            factTable={factTable}
            canEdit={false}
          />
        )}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3">
      <Flex
        direction="column"
        gap="2"
        role="group"
        aria-label="Retention period"
      >
        <Text weight="semibold">Retention period</Text>
        <Flex gap="2" align="center" wrap="wrap">
          <Select
            aria-label="Retention period mode"
            style={{ minWidth: 120, flexShrink: 0 }}
            value={mode}
            setValue={(value) =>
              onWindowSettingsChange(
                onRetentionDelayOrModeChange(windowSettings, {
                  type: "mode",
                  value: value as "starting" | "between",
                }),
              )
            }
          >
            <SelectItem value="starting">Starting</SelectItem>
            <SelectItem value="between">Between</SelectItem>
          </Select>
          <TextField
            aria-label="Delay value"
            type="number"
            style={{ width: 80 }}
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
              <Text>and</Text>
              <TextField
                aria-label="End value"
                type="number"
                style={{ width: 80 }}
                value={retentionEnd(windowSettings)}
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
            aria-label="Time unit"
            style={{ minWidth: 100, flexShrink: 0 }}
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
          <Text whiteSpace="nowrap">after exposure</Text>
        </Flex>
      </Flex>

      <Flex direction="column" gap="3">
        <Switch
          label="Require a minimum amount (Threshold)"
          value={hasThreshold}
          onChange={(checked) =>
            onThresholdChange(
              checked
                ? { aggregateFilterColumn: "$$count", aggregateFilter: "" }
                : // Explicit undefined, not {} - onThresholdChange merges this
                  // into the existing numerator (MetricEditor.tsx), so an empty
                  // object would leave both fields exactly as they were and
                  // hasThreshold would immediately read true again next render.
                  {
                    aggregateFilterColumn: undefined,
                    aggregateFilter: undefined,
                  },
            )
          }
        />
        {hasThreshold && (
          <Box pl="5">
            <ThresholdBasisRow
              value={threshold}
              onChange={onThresholdChange}
              factTable={factTable}
            />
          </Box>
        )}
      </Flex>
    </Flex>
  );
}
