import { CreateFactMetricProps } from "@back-end/types/fact-table";
import { MetricDefaults } from "@back-end/types/organization";
import { UseFormReturn } from "react-hook-form";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MetricFormData } from "@/components/Metrics/MetricForm";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function MetricPriorSettingsForm({
  form,
  metricDefaults,
}: {
  form: UseFormReturn<MetricFormData | CreateFactMetricProps>;
  metricDefaults: MetricDefaults;
}) {
  return (
    <>
      <label className="mb-1">Metric Priors</label>
      <small className="d-block mb-1 text-muted">
        Only applicable to bayesian analyses
      </small>
      <div className="px-3 py-2 pb-0 mb-2 border rounded">
        <div className="form-group mb-0 mr-0 form-inline">
          <div className="form-inline my-1">
            <input
              type="checkbox"
              className="form-check-input"
              {...form.register("priorSettings.override")}
              id={"toggle-properPriorOverride"}
            />
            <label
              className="mr-1 cursor-pointer"
              htmlFor="toggle-properPriorOverride"
            >
              Override organization-level settings
            </label>
          </div>
        </div>
        <div
          style={{
            display: form.watch("priorSettings.override") ? "block" : "none",
          }}
        >
          <div className="d-flex my-2 border-bottom"></div>
          <div className="form-group mt-3 mb-0 mr-2 form-inline">
            <label
              className="mr-1"
              htmlFor="toggle-regressionAdjustmentEnabled"
            >
              Use proper prior for this metric
            </label>
            <Toggle
              id={"toggle-properPrior"}
              value={!!form.watch("priorSettings.proper")}
              setValue={(value) => {
                form.setValue("priorSettings.proper", value);
              }}
            />
            <small className="form-text text-muted">
              (organization default:{" "}
              {metricDefaults.priorSettings?.proper ? "On" : "Off"})
            </small>
          </div>

          {(metricDefaults.priorSettings?.proper &&
            !form.watch("priorSettings.override")) ||
          form.watch("priorSettings.proper") ? (
            <>
              <div className="row">
                <div className="col">
                  <Field
                    label="Prior Mean"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    required
                    helpText={`Organization default: ${
                      metricDefaults.priorSettings?.mean ?? 0
                    }`}
                    {...form.register("priorSettings.mean", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="col">
                  <Field
                    label="Prior Standard Deviation"
                    type="number"
                    step="any"
                    containerClassName="mb-0 mt-3"
                    min="0"
                    required
                    helpText={`Organization default: ${
                      metricDefaults.priorSettings?.stddev ??
                      DEFAULT_PROPER_PRIOR_STDDEV
                    }`}
                    {...form.register("priorSettings.stddev", {
                      valueAsNumber: true,
                      validate: (v) => {
                        return !(v <= 0);
                      },
                    })}
                  />
                </div>
              </div>
              <div>
                <small className="text-muted mt-1">
                  {`Your prior beliefs are that the average lift is ${percentFormatter.format(
                    form.watch("priorSettings.mean")
                  )}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                    -1 * form.watch("priorSettings.stddev") +
                      form.watch("priorSettings.mean")
                  )} and ${percentFormatter.format(
                    form.watch("priorSettings.stddev") +
                      form.watch("priorSettings.mean")
                  )}`}
                </small>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
