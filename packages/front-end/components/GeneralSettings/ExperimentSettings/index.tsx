import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { MdInfoOutline } from "react-icons/md";
import { FaQuestionCircle } from "react-icons/fa";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import Toggle from "@/components/Forms/Toggle";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import StatsEngineSettings from "./StatsEngineSettings";
import StickyBucketingSettings from "./StickyBucketingSettings";

export default function ExperimentSettings({
  cronString,
  updateCronString,
}: {
  cronString: string;
  updateCronString: (value: string) => void;
}) {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();

  const queryParams = new URLSearchParams(window.location.search);

  const [editChecklistOpen, setEditChecklistOpen] = useState(
    () => queryParams.get("editCheckListModal") || false
  );

  const srmThreshold = form.watch("srmThreshold");
  const srmHighlightColor =
    srmThreshold && (srmThreshold > 0.01 || srmThreshold < 0.001)
      ? "#B39F01"
      : "";
  const srmWarningMsg =
    srmThreshold && srmThreshold > 0.01
      ? "Thresholds above 0.01 may lead to many false positives, especially if you refresh results regularly."
      : srmThreshold && srmThreshold < 0.001
      ? "Thresholds below 0.001 may make it hard to detect imbalances without lots of traffic."
      : "";

  return (
    <>
      <div className="row">
        <div className="col-sm-3">
          <h4>Experiment Settings</h4>
        </div>

        <div className="col-sm-9">
          <div className="form-inline flex-column align-items-start mb-3">
            <Field
              label="Minimum experiment length (in days) when importing past
                  experiments"
              type="number"
              className="ml-2"
              containerClassName="mb-3"
              append="days"
              step="1"
              min="0"
              max="31"
              disabled={hasFileConfig()}
              {...form.register("pastExperimentsMinLength", {
                valueAsNumber: true,
                min: 0,
                max: 31,
              })}
            />

            <Field
              label="Warn when this percent of experiment users are in multiple variations"
              type="number"
              step="1"
              min="0"
              max="100"
              className="ml-2"
              containerClassName="mb-3"
              append="%"
              style={{
                width: "80px",
              }}
              disabled={hasFileConfig()}
              {...form.register("multipleExposureMinPercent", {
                valueAsNumber: true,
                min: 0,
                max: 100,
              })}
            />

            <div className="mb-3 form-group flex-column align-items-start">
              <SelectField
                label={
                  <AttributionModelTooltip>
                    Default Conversion Window Override <FaQuestionCircle />
                  </AttributionModelTooltip>
                }
                className="ml-2"
                value={form.watch("attributionModel")}
                onChange={(value) => {
                  form.setValue("attributionModel", value);
                }}
                options={[
                  {
                    label: "Respect Conversion Windows",
                    value: "firstExposure",
                  },
                  {
                    label: "Ignore Conversion Windows",
                    value: "experimentDuration",
                  },
                ]}
              />
            </div>

            <div className="mb-4 form-group flex-column align-items-start">
              <Field
                label="Experiment Auto-Update Frequency"
                className="ml-2"
                containerClassName="mb-2 mr-2"
                disabled={hasFileConfig()}
                options={[
                  {
                    display: "When results are X hours old",
                    value: "stale",
                  },
                  {
                    display: "Cron Schedule",
                    value: "cron",
                  },
                  {
                    display: "Never",
                    value: "never",
                  },
                ]}
                {...form.register("updateSchedule.type")}
              />
              {form.watch("updateSchedule")?.type === "stale" && (
                <div className="bg-light p-3 border">
                  <Field
                    label="Refresh when"
                    append="hours old"
                    type="number"
                    step={1}
                    min={1}
                    max={168}
                    className="ml-2"
                    disabled={hasFileConfig()}
                    {...form.register("updateSchedule.hours")}
                  />
                </div>
              )}
              {form.watch("updateSchedule")?.type === "cron" && (
                <div className="bg-light p-3 border">
                  <Field
                    label="Cron String"
                    className="ml-2"
                    disabled={hasFileConfig()}
                    {...form.register("updateSchedule.cron")}
                    placeholder="0 */6 * * *"
                    onFocus={(e) => {
                      updateCronString(e.target.value);
                    }}
                    onBlur={(e) => {
                      updateCronString(e.target.value);
                    }}
                    helpText={<span className="ml-2">{cronString}</span>}
                  />
                </div>
              )}
            </div>

            <div className="d-flex form-group mb-3">
              <label
                className="mr-1"
                htmlFor="toggle-factTableQueryOptimization"
              >
                <PremiumTooltip
                  commercialFeature="multi-metric-queries"
                  body={
                    <>
                      <p>
                        If multiple metrics from the same Fact Table are added
                        to an experiment, this will combine them into a single
                        query, which is much faster and more efficient.
                      </p>
                      <p>
                        For data sources with usage-based billing like BigQuery
                        or SnowFlake, this can result in substantial cost
                        savings.
                      </p>
                    </>
                  }
                >
                  Fact Table Query Optimization{" "}
                  <MdInfoOutline className="text-info" />
                </PremiumTooltip>
              </label>
              <Toggle
                id={"toggle-factTableQueryOptimization"}
                value={
                  hasCommercialFeature("multi-metric-queries") &&
                  !form.watch("disableMultiMetricQueries")
                }
                setValue={(value) => {
                  form.setValue("disableMultiMetricQueries", !value);
                }}
                disabled={!hasCommercialFeature("multi-metric-queries")}
              />
            </div>
          </div>

          <StatsEngineSettings />

          <div className="d-flex form-group mb-3">
            <label className="mr-1" htmlFor="toggle-factTableQueryOptimization">
              <span className="badge badge-purple text-uppercase mr-2">
                Alpha
              </span>
              Enable Power Calculator
            </label>
            <Toggle
              id="toggle-powerCalculator"
              value={form.watch("powerCalculatorEnabled")}
              setValue={(value) => {
                form.setValue("powerCalculatorEnabled", !!value);
              }}
            />
          </div>

          <StickyBucketingSettings />

          <h4 className="mt-4 mb-2">Experiment Health Settings</h4>
          <div className="appbox pt-2 px-3">
            <div className="form-group mb-2 mt-2 mr-2 form-inline">
              <label className="mr-1" htmlFor="toggle-runHealthTrafficQuery">
                Run traffic query by default
              </label>
              <Toggle
                id="toggle-runHealthTrafficQuery"
                value={!!form.watch("runHealthTrafficQuery")}
                setValue={(value) => {
                  form.setValue("runHealthTrafficQuery", value);
                }}
              />
            </div>

            <div className="mt-3 form-inline flex-column align-items-start">
              <Field
                label="SRM p-value threshold"
                type="number"
                step="0.001"
                style={{
                  borderColor: srmHighlightColor,
                  backgroundColor: srmHighlightColor
                    ? srmHighlightColor + "15"
                    : "",
                }}
                max="0.1"
                min="0.00001"
                className="ml-2"
                containerClassName="mb-3"
                append=""
                disabled={hasFileConfig()}
                helpText={
                  <>
                    <span className="ml-2">(0.001 is default)</span>
                    <div
                      className="ml-2"
                      style={{
                        color: srmHighlightColor,
                        flexBasis: "100%",
                      }}
                    >
                      {srmWarningMsg}
                    </div>
                  </>
                }
                {...form.register("srmThreshold", {
                  valueAsNumber: true,
                  min: 0,
                  max: 1,
                })}
              />
            </div>
          </div>

          <div className="mb-3 form-group flex-column align-items-start">
            <PremiumTooltip
              commercialFeature="custom-launch-checklist"
              premiumText="Custom pre-launch checklists are available to Enterprise customers"
            >
              <div className="d-inline-block h4 mt-4 mb-0">
                Experiment Pre-Launch Checklist
              </div>
            </PremiumTooltip>
            <p className="pt-2">
              Configure required steps that need to be completed before an
              experiment can be launched.
            </p>
            <Button
              disabled={!hasCommercialFeature("custom-launch-checklist")}
              onClick={async () => {
                setEditChecklistOpen(true);
              }}
            >
              Edit Checklist
            </Button>
          </div>
        </div>
      </div>
      {editChecklistOpen ? (
        <ExperimentCheckListModal close={() => setEditChecklistOpen(false)} />
      ) : null}
    </>
  );
}
