import { useEffect, useRef, useState, type Ref } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import {
  DEFAULT_NEW_EXPERIMENT_MAX_DURATION,
  MAX_EXPERIMENT_DURATION_UNITS,
  type MaxExperimentDuration,
  type MaxExperimentDurationUnit,
} from "shared/experiments";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

const unitOptions = MAX_EXPERIMENT_DURATION_UNITS.map((u) => ({
  label: u.charAt(0).toUpperCase() + u.slice(1),
  value: u,
}));

type MaxDurationForm = {
  maxExperimentDuration: MaxExperimentDuration;
};

function normalizeDuration(
  partial: MaxExperimentDuration | undefined,
): MaxExperimentDuration {
  const base = partial ?? DEFAULT_NEW_EXPERIMENT_MAX_DURATION;
  const value =
    typeof base.value === "number" &&
    Number.isFinite(base.value) &&
    base.value >= 1
      ? base.value
      : DEFAULT_NEW_EXPERIMENT_MAX_DURATION.value;
  const unit = MAX_EXPERIMENT_DURATION_UNITS.includes(
    base.unit as MaxExperimentDurationUnit,
  )
    ? base.unit
    : DEFAULT_NEW_EXPERIMENT_MAX_DURATION.unit;
  return { value, unit };
}

/** Validate raw form value so invalid numbers are not masked by `normalizeDuration`. */
function validateMaxExperimentDuration(
  v: MaxExperimentDuration | undefined,
): true | string {
  if (v == null || typeof v !== "object") {
    return "Must be at least 1";
  }
  const { value, unit } = v;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return "Must be at least 1";
  }
  if (
    !MAX_EXPERIMENT_DURATION_UNITS.includes(unit as MaxExperimentDurationUnit)
  ) {
    return "Choose a valid unit (hours, days, or weeks).";
  }
  return true;
}

function parsePositiveDurationValue(raw: string): number | undefined {
  if (raw === "" || !/^\d+$/.test(raw)) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/**
 * Text input so users can clear and re-type freely (number + min coerces invalid
 * intermediates; the old handler also replaced empty input with the previous value).
 */
function DurationValueField({
  value,
  onCommittedChange,
  onBlur,
  disabled,
  name,
  inputRef,
}: {
  value: number;
  onCommittedChange: (n: number) => void;
  onBlur: () => void;
  disabled?: boolean;
  name: string;
  inputRef: Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState(() => String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  return (
    <Field
      label="Duration value"
      labelClassName="font-weight-bold"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      name={name}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        setDraft(String(value));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw !== "" && !/^\d+$/.test(raw)) {
          return;
        }
        setDraft(raw);
        const n = parsePositiveDurationValue(raw);
        if (n !== undefined) {
          onCommittedChange(n);
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        const n = parsePositiveDurationValue(draft) ?? value;
        onCommittedChange(n);
        setDraft(String(n));
        onBlur();
      }}
      ref={inputRef}
    />
  );
}

export function MaxExperimentDurationFields({
  form: formProp,
  disabled,
}: {
  /** `react-hook-form` instance that includes `maxExperimentDuration` (e.g. AnalysisForm). */
  form: unknown;
  disabled?: boolean;
}) {
  const form = formProp as UseFormReturn<MaxDurationForm>;

  return (
    <div className="form-group">
      <div className="font-weight-bold mb-2">Maximum experiment duration</div>
      <Controller
        name="maxExperimentDuration"
        control={form.control}
        rules={{
          validate: (v) => validateMaxExperimentDuration(v),
        }}
        render={({ field }) => {
          const duration = normalizeDuration(field.value);
          return (
            <div className="row">
              <div className="col-4">
                <DurationValueField
                  value={duration.value}
                  onCommittedChange={(n) =>
                    field.onChange(
                      normalizeDuration({
                        ...duration,
                        value: n,
                      }),
                    )
                  }
                  onBlur={field.onBlur}
                  disabled={disabled}
                  name={`${field.name}.value`}
                  inputRef={field.ref}
                />
              </div>
              <div className="col-4">
                <SelectField
                  label="Unit"
                  labelClassName="font-weight-bold"
                  value={duration.unit}
                  onChange={(v) =>
                    field.onChange(
                      normalizeDuration({
                        ...duration,
                        unit: v as MaxExperimentDurationUnit,
                      }),
                    )
                  }
                  options={unitOptions}
                  sort={false}
                  disabled={disabled}
                />
              </div>
            </div>
          );
        }}
      />
      <small className="form-text text-muted d-block">
        Calendar limit from the start of the current phase. After this window,
        the experiment status will be marked stopped and the Experiment Decision
        Framework will render a recommendation.
      </small>
    </div>
  );
}
