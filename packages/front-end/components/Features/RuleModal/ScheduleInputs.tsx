// Simplified scheduling panel for the "Schedule" radio option in StandardRuleFields.
// Exposes only a start trigger and an end trigger — no ramp steps, no coverage,
// no presets. Under the hood it writes into RampSectionState so the save path is
// identical to the ramp schedule path.
//
// Wiring (automatic — not exposed as checkboxes to the user):
//   • Start = "On" (specific-time) → disableRuleBefore = true
//   • Start = "Immediately"        → disableRuleBefore = false
//   • End   = "On" (specific-time) → disableRuleAfter  = true
//   • End   = "Never"              → disableRuleAfter  = false

import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import DatePicker from "@/components/DatePicker";
import type {
  RampSectionState,
  StartMode,
} from "@/components/Features/RuleModal/RampScheduleSection";

interface Props {
  state: RampSectionState;
  setState: (s: RampSectionState) => void;
}

/** Auto-generate a human-readable schedule name based on start/end dates. */
export function scheduleAutoName(state: RampSectionState): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  const hasStart = state.startMode === "specific-time" && !!state.startTime;
  const hasEnd = !!state.endScheduleAt;
  if (hasStart && hasEnd) {
    return `enable on ${fmt(state.startTime)}, disable on ${fmt(state.endScheduleAt)}`;
  }
  if (hasStart) return `enable on ${fmt(state.startTime)}`;
  if (hasEnd) return `disable on ${fmt(state.endScheduleAt)}`;
  return "schedule";
}

const START_OPTIONS = [
  {
    value: "immediately",
    label: "Immediately",
  },
  {
    value: "specific-time",
    label: "On",
    tooltip: "Rule becomes active at a specific date and time",
  },
];

const END_OPTIONS = [
  {
    value: "never",
    label: "Never",
  },
  {
    value: "specific-time",
    label: "On",
    tooltip: "Rule is automatically disabled at a specific date and time",
  },
];

function formatOptionLabel(
  option: { label: string; tooltip?: string },
  meta: { context: string },
) {
  if (meta.context === "value") return <>{option.label}</>;
  return (
    <div>
      <div>{option.label}</div>
      {option.tooltip && (
        <div
          style={{ fontSize: 11, color: "var(--color-text-low)", marginTop: 1 }}
        >
          {option.tooltip}
        </div>
      )}
    </div>
  );
}

export default function ScheduleInputs({ state, setState }: Props) {
  const endTriggerValue = state.endScheduleAt ? "specific-time" : "never";

  function patchState(patch: Partial<RampSectionState>) {
    setState({ ...state, ...patch });
  }

  function handleStartChange(v: string) {
    const mode = v as StartMode;
    if (mode === "immediately") {
      patchState({
        startMode: "immediately",
        startTime: "",
        disableRuleBefore: false,
      });
    } else {
      const d = new Date();
      d.setSeconds(0, 0);
      patchState({
        startMode: "specific-time",
        startTime: d.toISOString().slice(0, 16),
        disableRuleBefore: true,
      });
    }
  }

  function handleEndChange(v: string) {
    if (v === "never") {
      patchState({ endScheduleAt: "", disableRuleAfter: false });
    } else {
      const d = new Date();
      d.setSeconds(0, 0);
      patchState({
        endScheduleAt: d.toISOString().slice(0, 16),
        disableRuleAfter: true,
        endEarlyWhenStepsComplete: false,
      });
    }
  }

  return (
    <Flex direction="column" gap="1">
      <Text size="medium" weight="medium">
        Define Schedule
      </Text>

      {/* Start row */}
      <Flex align="center" gap="3" py="2">
        <Box style={{ width: 48 }}>
          <Text size="small" weight="medium" color="text-low">
            Start
          </Text>
        </Box>
        <SelectField
          value={
            state.startMode === "specific-time"
              ? "specific-time"
              : "immediately"
          }
          options={START_OPTIONS}
          onChange={handleStartChange}
          containerClassName="mb-0"
          containerStyle={{ minHeight: 38, width: 150 }}
          useMultilineLabels
          formatOptionLabel={formatOptionLabel}
        />
        {state.startMode === "specific-time" && (
          <DatePicker
            date={state.startTime || undefined}
            setDate={(d) => patchState({ startTime: d ? d.toISOString() : "" })}
            precision="datetime"
            containerClassName="mb-0"
            scheduleEndDate={state.endScheduleAt || undefined}
          />
        )}
      </Flex>

      {/* End row */}
      <Flex align="center" gap="3" py="2">
        <Box style={{ width: 48 }}>
          <Text size="small" weight="medium" color="text-low">
            End
          </Text>
        </Box>
        <SelectField
          value={endTriggerValue}
          options={END_OPTIONS}
          onChange={handleEndChange}
          containerClassName="mb-0"
          containerStyle={{ minHeight: 38, width: 150 }}
          useMultilineLabels
          formatOptionLabel={formatOptionLabel}
        />
        {endTriggerValue === "specific-time" && (
          <DatePicker
            date={state.endScheduleAt || undefined}
            setDate={(d) =>
              patchState({ endScheduleAt: d ? d.toISOString() : "" })
            }
            precision="datetime"
            containerClassName="mb-0"
            scheduleStartDate={state.startTime || undefined}
            disableBefore={
              state.startTime ? new Date(state.startTime) : new Date()
            }
          />
        )}
      </Flex>
    </Flex>
  );
}
