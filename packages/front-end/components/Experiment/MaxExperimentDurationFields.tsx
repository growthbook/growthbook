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
          validate: (v) => {
            const d = normalizeDuration(v);
            return d.value >= 1 || "Must be at least 1";
          },
        }}
        render={({ field }) => {
          const duration = normalizeDuration(field.value);
          return (
            <div className="row">
              <div className="col-4">
                <Field
                  label="Duration value"
                  labelClassName="font-weight-bold"
                  type="number"
                  min={1}
                  step={1}
                  disabled={disabled}
                  name={`${field.name}.value`}
                  value={duration.value}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = raw === "" ? NaN : Number.parseFloat(raw);
                    field.onChange(
                      normalizeDuration({
                        ...duration,
                        value: Number.isFinite(n) ? n : duration.value,
                      }),
                    );
                  }}
                  onBlur={field.onBlur}
                  ref={field.ref}
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
                  disabled={disabled}
                />
              </div>
            </div>
          );
        }}
      />
      <small className="form-text text-muted d-block">
        Calendar limit from the start of the current phase. After this window,
        the experiment may be treated as complete for scheduling and analysis.
      </small>
    </div>
  );
}
