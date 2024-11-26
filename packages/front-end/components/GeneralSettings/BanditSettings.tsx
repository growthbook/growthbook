import { useFormContext } from "react-hook-form";
import React from "react";
import clsx from "clsx";
import { ScopedSettings } from "shared/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import HelperText from "@/components/Radix/HelperText";

export default function BanditSettings({
  page = "org-settings",
  settings,
  lockExploratoryStage,
}: {
  page?: "org-settings" | "experiment-settings";
  settings?: ScopedSettings;
  lockExploratoryStage?: boolean;
}) {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();
  const hasBandits = hasCommercialFeature("multi-armed-bandits");

  const scheduleHours =
    parseFloat(form.watch("banditScheduleValue") ?? "0") *
    (form.watch("banditScheduleUnit") === "days" ? 24 : 1);
  const scheduleWarning =
    scheduleHours < 1
      ? "Update cadence should be at least 15 minutes longer than it takes to run your data warehouse query"
      : scheduleHours > 24 * 3
      ? "Update cadences longer than 3 days can result in slow learning"
      : null;

  return (
    <div className="row">
      {page === "org-settings" && (
        <div className="col-sm-3">
          <h4>Bandit Settings</h4>
        </div>
      )}
      <div
        className={clsx({
          "col-sm-9": page === "org-settings",
          "col mb-2": page === "experiment-settings",
        })}
      >
        {page === "org-settings" && (
          <>
            <PremiumTooltip
              commercialFeature="multi-armed-bandits"
              premiumText="Bandits are a Pro feature"
            >
              <div className="d-inline-block h5 mb-0">Bandit Defaults</div>
            </PremiumTooltip>
            <p className="mt-2">
              These are organizational default values for configuring Bandits.
              You can always change these values on a per-experiment basis.
            </p>
          </>
        )}

        <div className="d-flex">
          <div className="col-6 pl-0">
            <label
              className={clsx("mb-0", {
                "font-weight-bold": page === "experiment-settings",
              })}
            >
              Exploratory Stage
            </label>
            <div className="small text-muted mb-2">
              Period before variation weights update:
            </div>
            <div className="row align-items-center">
              <div className="col-auto">
                <Field
                  {...form.register("banditBurnInValue", {
                    valueAsNumber: true,
                  })}
                  type="number"
                  min={0}
                  max={999}
                  step={"any"}
                  style={{ width: 70 }}
                  disabled={!hasBandits || lockExploratoryStage}
                />
              </div>
              <div className="col-auto">
                <SelectField
                  value={form.watch("banditBurnInUnit")}
                  onChange={(value) => {
                    form.setValue(
                      "banditBurnInUnit",
                      value as "hours" | "days"
                    );
                  }}
                  sort={false}
                  options={[
                    {
                      label: "Hour(s)",
                      value: "hours",
                    },
                    {
                      label: "Day(s)",
                      value: "days",
                    },
                  ]}
                  disabled={!hasBandits || lockExploratoryStage}
                />
              </div>
            </div>
            {page === "experiment-settings" && (
              <div className="text-muted small mt-1">
                Default:{" "}
                <strong>
                  {settings?.banditBurnInValue?.value ?? 1}{" "}
                  {settings?.banditBurnInUnit?.value ?? "days"}
                </strong>
              </div>
            )}
            {lockExploratoryStage && page === "experiment-settings" && (
              <HelperText status="info">
                Exploratory stage has already ended
              </HelperText>
            )}
          </div>

          <div className="col-6 pr-0">
            <label
              className={clsx("mb-0", {
                "font-weight-bold": page === "experiment-settings",
              })}
            >
              Update Cadence
            </label>
            <div className="small text-muted mb-2">
              Update variation weights every:
            </div>
            <div className="row align-items-center">
              <div className="col-auto">
                <Field
                  {...form.register("banditScheduleValue", {
                    valueAsNumber: true,
                  })}
                  type="number"
                  min={0}
                  max={999}
                  step={"any"}
                  style={{ width: 70 }}
                  disabled={!hasBandits}
                />
              </div>
              <div className="col-auto">
                <SelectField
                  value={form.watch("banditScheduleUnit")}
                  onChange={(value) => {
                    form.setValue(
                      "banditScheduleUnit",
                      value as "hours" | "days"
                    );
                  }}
                  sort={false}
                  options={[
                    {
                      label: "Hour(s)",
                      value: "hours",
                    },
                    {
                      label: "Day(s)",
                      value: "days",
                    },
                  ]}
                  disabled={!hasBandits}
                />
              </div>
            </div>
            {page === "experiment-settings" && (
              <div className="text-muted small mt-1">
                Default:{" "}
                <strong>
                  {settings?.banditScheduleValue?.value ?? 1}{" "}
                  {settings?.banditScheduleUnit?.value ?? "days"}
                </strong>
              </div>
            )}
            {scheduleWarning ? (
              <HelperText status="warning" size="sm" mt="1">
                {scheduleWarning}
              </HelperText>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
