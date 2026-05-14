import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

export function MetricDelaySettings({ form }) {
  return (
    <div className="form-group">
      <label>Metric Delay</label>
      <div className="appbox px-3 pt-3 bg-light">
        <div className="row align-items-center mb-3">
          <div className="col-auto">Begin using metric data</div>
          <div className="col-auto">
            <Field
              {...form?.register("windowSettings.delayValue", {
                valueAsNumber: true,
              })}
              type="number"
              placeholder={"0"}
              style={{ width: 70 }}
              required
              autoFocus
            />
          </div>
          <div className="col-auto">
            <SelectField
              value={form?.watch("windowSettings.delayUnit")}
              onChange={(value) => {
                form.setValue(
                  "windowSettings.delayUnit",
                  value as "minutes" | "hours" | "days" | "weeks",
                );
              }}
              sort={false}
              options={[
                {
                  label: "Minutes",
                  value: "minutes",
                },
                {
                  label: "Hours",
                  value: "hours",
                },
                {
                  label: "Days",
                  value: "days",
                },
                {
                  label: "Weeks",
                  value: "weeks",
                },
              ]}
            />
          </div>
          <div className="col-auto">after experiment exposure</div>
        </div>
      </div>
    </div>
  );
}
