import { CappingType } from "back-end/types/fact-table";
import Field from "@front-end/components/Forms/Field";
import SelectField from "@front-end/components/Forms/SelectField";
import Toggle from "@front-end/components/Forms/Toggle";

export function MetricCappingSettingsForm({
  form,
  datasourceType,
  metricType,
}) {
  const cappingOptions = [
    {
      value: "",
      label: "No",
    },
    ...(metricType !== "ratio"
      ? [
          {
            value: "absolute",
            label: "Absolute capping",
          },
        ]
      : []),
    ...(datasourceType !== "mixpanel"
      ? [
          {
            value: "percentile",
            label: "Percentile capping",
          },
        ]
      : []),
  ];
  return (
    <div className="form-group">
      <SelectField
        label="Cap User Values?"
        value={form.watch("cappingSettings.type")}
        onChange={(v: CappingType) => {
          form.setValue("cappingSettings.type", v);
        }}
        sort={false}
        options={cappingOptions}
        helpText="Capping (winsorization) can reduce variance by capping aggregated
      user values."
      />
      <div
        style={{
          display: form.watch("cappingSettings.type") ? "block" : "none",
        }}
        className="appbox p-3 bg-light"
      >
        {form.watch("cappingSettings.type") ? (
          <>
            <Field
              label="Capped Value"
              type="number"
              step="any"
              min="0"
              max={
                form.watch("cappingSettings.type") === "percentile" ? "1" : ""
              }
              {...form.register("cappingSettings.value", {
                valueAsNumber: true,
              })}
              helpText={
                form.watch("cappingSettings.type") === "absolute"
                  ? `
              Absolute capping: if greater than zero, aggregated user values will be capped at this value.`
                  : `Percentile capping: if greater than zero, we use all metric data in the experiment to compute the percentiles of the user aggregated values. Then, we get the value at the percentile provided and cap all users at this value. Enter a number between 0 and 0.99999`
              }
            />
            {form.watch("cappingSettings.type") === "percentile" ? (
              <div className="mt-3">
                <label className="mr-1" htmlFor="toggle-ignoreZeros">
                  Ignore zero values in percentile calculation?
                </label>
                <Toggle
                  value={form.watch("cappingSettings.ignoreZeros")}
                  setValue={(ignoreZeros) => {
                    form.setValue("cappingSettings.ignoreZeros", ignoreZeros);
                  }}
                  id={"ignoreZeros"}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
