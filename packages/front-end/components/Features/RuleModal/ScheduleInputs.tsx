// Simplified scheduling panel for the "Schedule" radio option in StandardRuleFields.
// Exposes only a start trigger and an end trigger — no ramp steps, no coverage,
// no presets. Under the hood it writes into RampSectionState so the save path is
// identical to the ramp schedule path.

import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import Heading from "@/ui/Heading";
import SelectField from "@/components/Forms/SelectField";
import DatePicker from "@/components/DatePicker";
import ScheduleRow from "@/components/Schedule/ScheduleRow";
import type { RampSectionState } from "@/components/Features/RuleModal/RampScheduleSection";

interface Props {
  state: RampSectionState;
  setState: (s: RampSectionState) => void;
  disabled?: boolean;
  // Lock only the Start row (e.g. an already-running schedule whose end date can
  // still be edited but whose start has already passed).
  disableStart?: boolean;
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
  const hasStart = !!state.startDate;
  const hasEnd = !!state.endScheduleAt;
  if (hasStart && hasEnd) {
    return `enable on ${fmt(state.startDate)}, disable on ${fmt(state.endScheduleAt)}`;
  }
  if (hasStart) return `enable on ${fmt(state.startDate)}`;
  if (hasEnd) return `disable on ${fmt(state.endScheduleAt)}`;
  return "schedule";
}

// `tooltip` here renders inline beneath the option label (subtitle style).
const START_OPTIONS = [
  {
    value: "immediately",
    label: msg`Immediately`,
  },
  {
    value: "specific-time",
    label: msg`On date`,
    tooltip: msg`Rule becomes active at a specific date and time`,
  },
];

const END_OPTIONS = [
  {
    value: "never",
    label: msg`Never`,
  },
  {
    value: "specific-time",
    label: msg`On date`,
    tooltip: msg`Rule is automatically disabled at a specific date and time`,
  },
];

function formatOptionLabel(
  option: { label: string; tooltip?: ReactNode },
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

export default function ScheduleInputs({
  state,
  setState,
  disabled,
  disableStart,
}: Props) {
  const { t, i18n } = useLingui();
  const startOptions = START_OPTIONS.map((o) => ({
    value: o.value,
    label: i18n._(o.label),
    tooltip: o.tooltip ? i18n._(o.tooltip) : undefined,
  }));
  const endOptions = END_OPTIONS.map((o) => ({
    value: o.value,
    label: i18n._(o.label),
    tooltip: o.tooltip ? i18n._(o.tooltip) : undefined,
  }));
  const endTriggerValue = state.endScheduleAt ? "specific-time" : "never";
  const startDisabled = disabled || disableStart;

  function patchState(patch: Partial<RampSectionState>) {
    setState({ ...state, ...patch });
  }

  function handleStartChange(v: string) {
    if (v === "immediately") {
      patchState({ startDate: "" });
    } else {
      const d = new Date();
      d.setSeconds(0, 0);
      patchState({ startDate: d.toISOString() });
    }
  }

  function handleEndChange(v: string) {
    if (v === "never") {
      patchState({ endScheduleAt: "" });
    } else {
      const d = new Date();
      d.setSeconds(0, 0);
      patchState({
        endScheduleAt: d.toISOString(),
      });
    }
  }

  return (
    <Flex direction="column" gap="1">
      <Heading as="h3" size="sm" mb="2">
        <Trans>Schedule</Trans>
      </Heading>

      {/* Start row */}
      <ScheduleRow label={t`Start`}>
        <SelectField
          size="legacy"
          value={state.startDate ? "specific-time" : "immediately"}
          options={startOptions}
          onChange={handleStartChange}
          disabled={startDisabled}
          containerClassName="mb-0"
          containerStyle={{ width: 150 }}
          useMultilineLabels
          formatOptionLabel={formatOptionLabel}
        />
        {state.startDate && (
          <DatePicker
            date={state.startDate || undefined}
            setDate={(d) => patchState({ startDate: d ? d.toISOString() : "" })}
            precision="datetime"
            timeZone="local"
            containerClassName="mb-0"
            scheduleEndDate={state.endScheduleAt || undefined}
            disabled={startDisabled}
          />
        )}
      </ScheduleRow>

      {/* End row */}
      <ScheduleRow label={t`End`}>
        <SelectField
          size="legacy"
          value={endTriggerValue}
          options={endOptions}
          onChange={handleEndChange}
          disabled={disabled}
          containerClassName="mb-0"
          containerStyle={{ width: 150 }}
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
            timeZone="local"
            containerClassName="mb-0"
            scheduleStartDate={state.startDate || undefined}
            disableBefore={
              state.startDate ? new Date(state.startDate) : new Date()
            }
            disabled={disabled}
          />
        )}
      </ScheduleRow>
    </Flex>
  );
}
