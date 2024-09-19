import { useFormContext } from "react-hook-form";
import React from "react";
import clsx from "clsx";
import { ScopedSettings } from "shared/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { DocLink } from "@/components/DocLink";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";

export default function BanditSettings({
  page = "org-settings",
  settings,
}: {
  page?: "org-settings" | "experiment-settings";
  settings?: ScopedSettings;
}) {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();
  const hasBandits = hasCommercialFeature("multi-armed-bandits");

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
              premiumText="Multi-Armed Bandits are a Pro feature"
            >
              <div className="d-inline-block h5 mb-0">
                Multi-Armed Bandit Defaults
              </div>
            </PremiumTooltip>
            <p className="mt-2">
              These are organizational default values for configuring
              multi-armed bandit experiments. You can always change these values
              on a per-experiment basis.
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
                    validate: (_) => {
                      return !(scheduleHours < 0.25);
                    },
                  })}
                  type="number"
                  min={0}
                  max={999}
                  step={1}
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
                      label: "Hours",
                      value: "hours",
                    },
                    {
                      label: "Days",
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
              <div className="text-warning-orange mt-2">{scheduleWarning}</div>
            ) : null}
          </div>

          <div className="col-6 pr-0">
            <label
              className={clsx("mb-0", {
                "font-weight-bold": page === "experiment-settings",
              })}
            >
              Explore Stage
            </label>
            <div className="small text-muted mb-2">
              How long to wait before updating variation weights:
            </div>
            <div className="row align-items-center">
              <div className="col-auto">
                <Field
                  {...form.register("banditBurnInValue", {
                    valueAsNumber: true,
                    validate: (v) => {
                      return !(v < 0);
                    },
                  })}
                  type="number"
                  min={0}
                  max={999}
                  step={1}
                  style={{ width: 70 }}
                  disabled={!hasBandits}
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
                      label: "Hours",
                      value: "hours",
                    },
                    {
                      label: "Days",
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
                  {settings?.banditBurnInValue?.value ?? 1}{" "}
                  {settings?.banditBurnInUnit?.value ?? "days"}
                </strong>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
