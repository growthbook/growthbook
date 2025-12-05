import { CappingType } from "back-end/types/fact-table";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";

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
              <Checkbox
                label="Ignore zero values in percentile calculation"
                value={form.watch("cappingSettings.ignoreZeros")}
                setValue={(ignoreZeros) => {
                  form.setValue("cappingSettings.ignoreZeros", ignoreZeros);
                }}
                id={"ignoreZeros"}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
