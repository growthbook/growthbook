import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

// TODO form type
export function MetricWindowSettingsForm({ form, type }) {
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
              value as "days" | "hours" | "weeks",
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
    </>
  );
  return (
    <div className="mb-3 mt-4">
      <div className="form-group mb-1">
        <SelectField
          label={"Metric Window"}
          value={form.watch("windowSettings.type")}
          onChange={(value) => {
            form.setValue(
              "windowSettings.type",
              value as "conversion" | "lookback" | "",
            );
          }}
          sort={false}
          options={[
            {
              label: "None",
              value: "",
            },
            {
              label: "Conversion Window",
              value: "conversion",
            },
            {
              label: "Lookback Window",
              value: "lookback",
            },
          ]}
        />
      </div>

      {form.watch("windowSettings.type") && (
        <div className="appbox p-3 bg-light">
          <div className="row align-items-center">
            {form.watch("windowSettings.type") === "conversion" && (
              <>
                <div className="col-auto">Use only data within</div>
                {windowSettingsFields}

                {type === "retention" ? (
                  <div className="col-auto">
                    of first experiment exposure + retention window
                  </div>
                ) : (
                  <div className="col-auto">
                    of first experiment exposure
                    {form.watch("windowSettings.delayValue") ? (
                      <>{" + metric delay"}</>
                    ) : null}
                  </div>
                )}
              </>
            )}
            {form.watch("windowSettings.type") === "lookback" && (
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
