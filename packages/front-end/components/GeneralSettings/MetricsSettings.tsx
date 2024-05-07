import { useFormContext } from "react-hook-form";
import { hasFileConfig } from "@/services/env";
import { supportedCurrencies } from "@/services/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

export default function MetricsSettings() {
  const form = useFormContext();
  const metricAnalysisDays = form.watch("metricAnalysisDays");
  const metricAnalysisDaysWarningMsg =
    metricAnalysisDays && metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";
  const currencyOptions = Object.entries(supportedCurrencies).map(
    ([value, label]) => ({ value, label }),
  );
  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>Metrics Settings</h4>
      </div>
      <div className="col-sm-9">
        <div className="form-inline">
          <Field
            label="Amount of historical data to use on metric analysis page"
            type="number"
            append="days"
            className="ml-2"
            containerClassName="mb-0"
            disabled={hasFileConfig()}
            {...form.register("metricAnalysisDays", {
              valueAsNumber: true,
            })}
          />
          {metricAnalysisDaysWarningMsg && (
            <small className="text-danger">
              {metricAnalysisDaysWarningMsg}
            </small>
          )}
        </div>

        {/* region Metrics Behavior Defaults */}
        <>
          <h5 className="mt-4">Metrics Behavior Defaults</h5>
          <p>
            These are the pre-configured default values that will be used when
            configuring metrics. You can always change these values on a
            per-metric basis.
          </p>

          {/* region Minimum Sample Size */}
          <div>
            <div className="form-inline">
              <Field
                label="Minimum Sample Size"
                type="number"
                min={0}
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.minimumSampleSize", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="text-muted mb-3">
                The total count required in an experiment variation before
                showing results
              </small>
            </p>
          </div>
          {/* endregion Minimum Sample Size */}

          {/* region Maximum Percentage Change */}
          <div>
            <div className="form-inline">
              <Field
                label="Maximum Percentage Change"
                type="number"
                min={0}
                append="%"
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.maxPercentageChange", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="text-muted mb-3">
                An experiment that changes the metric by more than this percent
                will be flagged as suspicious
              </small>
            </p>
          </div>
          {/* endregion Maximum Percentage Change */}

          {/* region Minimum Percentage Change */}
          <div>
            <div className="form-inline">
              <Field
                label="Minimum Percentage Change"
                type="number"
                min={0}
                append="%"
                className="ml-2"
                containerClassName="mt-2"
                disabled={hasFileConfig()}
                {...form.register("metricDefaults.minPercentageChange", {
                  valueAsNumber: true,
                  min: 0,
                })}
              />
            </div>
            <p>
              <small className="text-muted mb-3">
                An experiment that changes the metric by less than this percent
                will be considered a draw
              </small>
            </p>
          </div>
          {/* endregion Minimum Percentage Change */}
        </>
        {/* endregion Metrics Behavior Defaults */}
        <>
          <SelectField
            label="Display Currency"
            value={form.watch("displayCurrency") || "USD"}
            options={currencyOptions}
            onChange={(v: string) => form.setValue("displayCurrency", v)}
            required
            placeholder="Select currency..."
            helpText="This should match what is stored in the data source and controls what currency symbol is displayed."
          />
        </>
      </div>
    </div>
  );
}
