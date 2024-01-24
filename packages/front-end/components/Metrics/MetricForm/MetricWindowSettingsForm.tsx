import Field from "../../Forms/Field";
import SelectField from "../../Forms/SelectField";

// TODO form type
export function MetricWindowSettingsForm({ form }) {
  const windowSettingsFields = (
    <>
      <div className="col-auto">
        <Field
          {...form.register("windowSettings.windowValue", {
            valueAsNumber: true,
          })}
          type="number"
          min={1}
          max={999}
          step={1}
          style={{ width: 70 }}
          required
          autoFocus
        />
      </div>
      <div className="col-auto">
        <SelectField
          value={form.watch("windowSettings.windowUnit")}
          onChange={(value) => {
            form.setValue(
              "windowSettings.windowUnit",
              value as "days" | "hours" | "weeks"
            );
          }}
          sort={false}
          options={[
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
    </>
  );
  return (
    <div className="mb-3 mt-4">
      <div className="form-group mb-1">
        <SelectField
          label={"Conversion/Lookback Window?"}
          value={form.watch("windowSettings.window")}
          onChange={(value) => {
            form.setValue(
              "windowSettings.window",
              value as "conversion" | "lookback" | ""
            );
          }}
          sort={false}
          options={[
            {
              label: "None",
              value: "",
            },
            {
              label: "Conversion",
              value: "conversion",
            },
            {
              label: "Lookback",
              value: "lookback",
            },
          ]}
        />
      </div>

      {form.watch("windowSettings.window") && (
        <div className="appbox p-3 bg-light">
          <div className="row align-items-center">
            {form.watch("windowSettings.window") === "conversion" && (
              <>
                <div className="col-auto">Use only data within</div>
                {windowSettingsFields}
                <div className="col-auto">of first experiment exposure</div>
              </>
            )}
            {form.watch("windowSettings.window") === "lookback" && (
              <>
                <div className="col-auto">Only use the latest</div>
                {windowSettingsFields}
                <div className="col-auto">of metric data in the experiment</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
