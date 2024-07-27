import { useFormContext } from "react-hook-form";
import React from "react";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { DocLink } from "@/components/DocLink";

export default function BanditSettings() {
  const form = useFormContext();

  // - < 1 hour produces warning: “Update cadence should be at least 15 minutes longer than it takes to run your data warehouse query.  Please see documentation for guidance.”   ‘documentation’ is linked to help page.
  // - > 3 days produces warning: “Update cadences longer than 3 days can result in slow learning, see documentation here.”

  const scheduleHours =
    parseFloat(form.watch("banditScheduleValue") ?? "0") *
    (form.watch("banditScheduleUnit") === "days" ? 24 : 1);
  const scheduleWarning =
    scheduleHours < 1 ? (
      <>
        Update cadence should be at least 15 minutes longer than it takes to run
        your data warehouse query.{" "}
        <DocLink docSection="experimentConfiguration">
          View Documentation
        </DocLink>
      </>
    ) : scheduleHours > 24 * 3 ? (
      <>
        Update cadences longer than 3 days can result in slow learning.{" "}
        <DocLink docSection="experimentConfiguration">
          View Documentation
        </DocLink>
      </>
    ) : null;

  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>Bandit Settings</h4>
      </div>
      <div className="col-sm-9">
        <h5>Multi-Armed Bandit Defaults</h5>
        <p>
          These are organizational default values for configuring multi-armed
          bandit experiments. You can always change these values on a
          per-experiment basis.
        </p>

        <div className="mb-4">
          <div className="row align-items-center">
            <label className="col-auto mb-0">Set burn-in period equal to</label>
            <div className="col-auto">
              <Field
                {...form.register("banditBurnInValue", {
                  valueAsNumber: true,
                })}
                type="number"
                min={1}
                max={999}
                step={1}
                style={{ width: 70 }}
              />
            </div>
            <div className="col-auto">
              <SelectField
                value={form.watch("banditBurnInUnit")}
                onChange={(value) => {
                  form.setValue("banditBurnInUnit", value as "days" | "hours");
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
                ]}
              />
            </div>
          </div>
          <small className="form-text text-muted">
            How long to wait (explore) before changing variation weights. If
            empty, uses default of 1 day.
          </small>
        </div>

        <div>
          <div className="row align-items-center">
            <label className="col-auto mb-0">
              Update variation weights every
            </label>
            <div className="col-auto">
              <Field
                {...form.register("banditScheduleValue", {
                  valueAsNumber: true,
                })}
                type="number"
                min={1}
                max={999}
                step={1}
                style={{ width: 70 }}
              />
            </div>
            <div className="col-auto">
              <SelectField
                value={form.watch("banditScheduleUnit")}
                onChange={(value) => {
                  form.setValue(
                    "banditScheduleUnit",
                    value as "days" | "hours"
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
                ]}
              />
            </div>
          </div>
          <small className="form-text text-muted">
            How often to analyze experiment results and compute new variation
            weights. If empty, uses default of 1 day.
          </small>
          {scheduleWarning ? (
            <div className="text-warning-orange mt-2">{scheduleWarning}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
