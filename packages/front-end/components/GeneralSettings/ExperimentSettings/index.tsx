import { useState } from "react";
import { StatsEngine, PValueCorrection } from "back-end/types/stats";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { MdInfoOutline } from "react-icons/md";
import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import useSDKConnections from "@/hooks/useSDKConnections";
import Button from "@/components/Button";
import { GBCuped, GBSequential } from "@/components/Icons";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import Tab from "@/components/Tabs/Tab";
import Toggle from "@/components/Forms/Toggle";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import {
  StickyBucketingToggleWarning,
  StickyBucketingTooltip,
} from "@/components/Features/FallbackAttributeSelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ConnectSettingsForm } from "@/pages/settings";

export default function ExperimentSettings({
  cronString,
  updateCronString,
  hasFileConfig,
  hasCommercialFeature,
  statsEngine,
}: {
  cronString: string;
  updateCronString: (value: string) => void;
  hasFileConfig: boolean;
  hasCommercialFeature: (feature: string) => boolean;
  statsEngine?: StatsEngine;
}) {
  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    statsEngine || DEFAULT_STATS_ENGINE
  );
  const [editChecklistOpen, setEditChecklistOpen] = useState(false);

  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
  }).includes("stickyBucketing");

  return (
    <ConnectSettingsForm>
      {({ register, setValue, watch }) => {
        const confidenceLevel = watch("confidenceLevel");
        const pValueThreshold = watch("pValueThreshold");
        const highlightColor =
          typeof confidenceLevel !== "undefined"
            ? confidenceLevel < 70
              ? "#c73333"
              : confidenceLevel < 80
              ? "#e27202"
              : confidenceLevel < 90
              ? "#B39F01"
              : ""
            : "";
        const warningMsg =
          typeof confidenceLevel !== "undefined"
            ? confidenceLevel === 70
              ? "This is as low as it goes"
              : confidenceLevel < 75
              ? "Confidence thresholds this low are not recommended"
              : confidenceLevel < 80
              ? "Confidence thresholds this low are not recommended"
              : confidenceLevel < 90
              ? "Use caution with values below 90%"
              : confidenceLevel >= 99
              ? "Confidence levels 99% and higher can take lots of data to achieve"
              : ""
            : "";
        const pHighlightColor =
          typeof pValueThreshold !== "undefined"
            ? pValueThreshold > 0.3
              ? "#c73333"
              : pValueThreshold > 0.2
              ? "#e27202"
              : pValueThreshold > 0.1
              ? "#B39F01"
              : ""
            : "";
        const pWarningMsg =
          typeof pValueThreshold !== "undefined"
            ? pValueThreshold === 0.5
              ? "This is as high as it goes"
              : pValueThreshold > 0.25
              ? "P-value thresholds this high are not recommended"
              : pValueThreshold > 0.2
              ? "P-value thresholds this high are not recommended"
              : pValueThreshold > 0.1
              ? "Use caution with values above 0.1"
              : pValueThreshold <= 0.01
              ? "Threshold values of 0.01 and lower can take lots of data to achieve"
              : ""
            : "";
        const regressionAdjustmentDays = watch("regressionAdjustmentDays");
        const regressionAdjustmentDaysHighlightColor =
          typeof regressionAdjustmentDays !== "undefined"
            ? regressionAdjustmentDays > 28 || regressionAdjustmentDays < 7
              ? "#e27202"
              : ""
            : "";
        const regressionAdjustmentDaysWarningMsg =
          typeof regressionAdjustmentDays !== "undefined"
            ? regressionAdjustmentDays > 28
              ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
              : regressionAdjustmentDays < 7
              ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
              : ""
            : "";
        const srmThreshold = watch("srmThreshold");
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
                    disabled={hasFileConfig}
                    {...register("pastExperimentsMinLength", {
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
                    disabled={hasFileConfig}
                    {...register("multipleExposureMinPercent", {
                      valueAsNumber: true,
                      min: 0,
                      max: 100,
                    })}
                  />

                  <div className="mb-3 form-group flex-column align-items-start">
                    <SelectField
                      label={
                        <AttributionModelTooltip>
                          Default Conversion Window Override{" "}
                          <FaQuestionCircle />
                        </AttributionModelTooltip>
                      }
                      className="ml-2"
                      value={watch("attributionModel")}
                      onChange={(value) => {
                        setValue("attributionModel", value);
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
                      disabled={hasFileConfig}
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
                      {...register("updateSchedule.type")}
                    />
                    {watch("updateSchedule")?.type === "stale" && (
                      <div className="bg-light p-3 border">
                        <Field
                          label="Refresh when"
                          append="hours old"
                          type="number"
                          step={1}
                          min={1}
                          max={168}
                          className="ml-2"
                          disabled={hasFileConfig}
                          {...register("updateSchedule.hours")}
                        />
                      </div>
                    )}
                    {watch("updateSchedule")?.type === "cron" && (
                      <div className="bg-light p-3 border">
                        <Field
                          label="Cron String"
                          className="ml-2"
                          disabled={hasFileConfig}
                          {...register("updateSchedule.cron")}
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
                              If multiple metrics from the same Fact Table are
                              added to an experiment, this will combine them
                              into a single query, which is much faster and more
                              efficient.
                            </p>
                            <p>
                              For data sources with usage-based billing like
                              BigQuery or SnowFlake, this can result in
                              substantial cost savings.
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
                        !watch("disableMultiMetricQueries")
                      }
                      setValue={(value) => {
                        setValue("disableMultiMetricQueries", !value);
                      }}
                      disabled={!hasCommercialFeature("multi-metric-queries")}
                    />
                  </div>

                  <StatsEngineSelect
                    label="Default Statistics Engine"
                    allowUndefined={false}
                    value={watch("statsEngine")}
                    onChange={(value) => {
                      setStatsEngineTab(value);
                      setValue("statsEngine", value);
                    }}
                    labelClassName="mr-2"
                  />
                </div>

                <div className="mb-3 form-group flex-column align-items-start">
                  <h4>Stats Engine Settings</h4>

                  <ControlledTabs
                    newStyle={true}
                    className="mt-3"
                    buttonsClassName="px-5"
                    tabContentsClassName="border"
                    active={statsEngineTab}
                    setActive={(v) =>
                      setStatsEngineTab(v || DEFAULT_STATS_ENGINE)
                    }
                  >
                    <Tab id="bayesian" display="Bayesian">
                      <h4 className="mb-4 text-purple">Bayesian Settings</h4>

                      <div className="form-group mb-2 mr-2 form-inline">
                        <Field
                          label="Chance to win threshold"
                          type="number"
                          step="any"
                          min="70"
                          max="99"
                          style={{
                            width: "80px",
                            borderColor: highlightColor,
                            backgroundColor: highlightColor
                              ? highlightColor + "15"
                              : "",
                          }}
                          className={`ml-2`}
                          containerClassName="mb-3"
                          append="%"
                          disabled={hasFileConfig}
                          helpText={
                            <>
                              <span className="ml-2">(95% is default)</span>
                              <div
                                className="ml-2"
                                style={{
                                  color: highlightColor,
                                  flexBasis: "100%",
                                }}
                              >
                                {warningMsg}
                              </div>
                            </>
                          }
                          {...register("confidenceLevel", {
                            valueAsNumber: true,
                            min: 50,
                            max: 100,
                          })}
                        />
                      </div>
                    </Tab>

                    <Tab id="frequentist" display="Frequentist">
                      <h4 className="mb-4 text-purple">Frequentist Settings</h4>

                      <div className="form-group mb-2 mr-2 form-inline">
                        <Field
                          label="P-value threshold"
                          type="number"
                          step="0.001"
                          max="0.5"
                          min="0.001"
                          style={{
                            borderColor: pHighlightColor,
                            backgroundColor: pHighlightColor
                              ? pHighlightColor + "15"
                              : "",
                          }}
                          className={`ml-2`}
                          containerClassName="mb-3"
                          append=""
                          disabled={hasFileConfig}
                          helpText={
                            <>
                              <span className="ml-2">(0.05 is default)</span>
                              <div
                                className="ml-2"
                                style={{
                                  color: pHighlightColor,
                                  flexBasis: "100%",
                                }}
                              >
                                {pWarningMsg}
                              </div>
                            </>
                          }
                          {...register("pValueThreshold", {
                            valueAsNumber: true,
                            min: 0,
                            max: 1,
                          })}
                        />
                      </div>
                      <div className="mb-3  form-inline flex-column align-items-start">
                        <SelectField
                          label={"Multiple comparisons correction to use: "}
                          className="ml-2"
                          value={watch("pValueCorrection") ?? ""}
                          onChange={(value) =>
                            setValue(
                              "pValueCorrection",
                              value as PValueCorrection
                            )
                          }
                          sort={false}
                          options={[
                            {
                              label: "None",
                              // @ts-expect-error This has been here and I'm afraid to change it now
                              value: null,
                            },
                            {
                              label: "Holm-Bonferroni (Control FWER)",
                              value: "holm-bonferroni",
                            },
                            {
                              label: "Benjamini-Hochberg (Control FDR)",
                              value: "benjamini-hochberg",
                            },
                          ]}
                        />
                      </div>
                      <div className="p-3 my-3 border rounded">
                        <h5 className="font-weight-bold mb-4">
                          <PremiumTooltip commercialFeature="regression-adjustment">
                            <GBCuped /> Regression Adjustment (CUPED)
                          </PremiumTooltip>
                        </h5>
                        <div className="form-group mb-0 mr-2">
                          <div className="d-flex">
                            <label
                              className="mr-1"
                              htmlFor="toggle-regressionAdjustmentEnabled"
                            >
                              Apply regression adjustment by default
                            </label>
                            <Toggle
                              id={"toggle-regressionAdjustmentEnabled"}
                              value={!!watch("regressionAdjustmentEnabled")}
                              setValue={(value) => {
                                setValue("regressionAdjustmentEnabled", value);
                              }}
                              disabled={
                                !hasCommercialFeature(
                                  "regression-adjustment"
                                ) || hasFileConfig
                              }
                            />
                          </div>
                          {watch("regressionAdjustmentEnabled") &&
                            watch("statsEngine") === "bayesian" && (
                              <div className="d-flex">
                                <small className="mb-1 text-warning-orange">
                                  <FaExclamationTriangle /> Your organization
                                  uses Bayesian statistics by default and
                                  regression adjustment is not implemented for
                                  the Bayesian engine.
                                </small>
                              </div>
                            )}
                        </div>
                        <div
                          className="form-group mt-3 mb-0 mr-2 form-inline"
                          style={{
                            opacity: watch("regressionAdjustmentEnabled")
                              ? "1"
                              : "0.5",
                          }}
                        >
                          <Field
                            label="Pre-exposure lookback period (days)"
                            type="number"
                            style={{
                              borderColor: regressionAdjustmentDaysHighlightColor,
                              backgroundColor: regressionAdjustmentDaysHighlightColor
                                ? regressionAdjustmentDaysHighlightColor + "15"
                                : "",
                            }}
                            className={`ml-2`}
                            containerClassName="mb-0"
                            append="days"
                            min="0"
                            max="100"
                            disabled={
                              !hasCommercialFeature("regression-adjustment") ||
                              hasFileConfig
                            }
                            helpText={
                              <>
                                <span className="ml-2">
                                  ({DEFAULT_REGRESSION_ADJUSTMENT_DAYS} is
                                  default)
                                </span>
                              </>
                            }
                            {...register("regressionAdjustmentDays", {
                              valueAsNumber: true,
                              validate: (v) => {
                                return !(v <= 0 || v > 100);
                              },
                            })}
                          />
                          {regressionAdjustmentDaysWarningMsg && (
                            <small
                              style={{
                                color: regressionAdjustmentDaysHighlightColor,
                              }}
                            >
                              {regressionAdjustmentDaysWarningMsg}
                            </small>
                          )}
                        </div>
                      </div>

                      <div className="p-3 my-3 border rounded">
                        <h5 className="font-weight-bold mb-4">
                          <PremiumTooltip commercialFeature="sequential-testing">
                            <GBSequential /> Sequential Testing
                          </PremiumTooltip>
                        </h5>
                        <div className="form-group mb-0 mr-2">
                          <div className="d-flex">
                            <label
                              className="mr-1"
                              htmlFor="toggle-sequentialTestingEnabled"
                            >
                              Apply sequential testing by default
                            </label>
                            <Toggle
                              id={"toggle-sequentialTestingEnabled"}
                              value={watch("sequentialTestingEnabled")}
                              setValue={(value) => {
                                setValue("sequentialTestingEnabled", value);
                              }}
                              disabled={
                                !hasCommercialFeature("sequential-testing") ||
                                hasFileConfig
                              }
                            />
                          </div>
                          {watch("sequentialTestingEnabled") &&
                            watch("statsEngine") === "bayesian" && (
                              <div className="d-flex">
                                <small className="mb-1 text-warning-orange">
                                  <FaExclamationTriangle /> Your organization
                                  uses Bayesian statistics by default and
                                  sequential testing is not implemented for the
                                  Bayesian engine.
                                </small>
                              </div>
                            )}
                        </div>
                        <div
                          className="form-group mt-3 mb-0 mr-2 form-inline"
                          style={{
                            opacity: watch("sequentialTestingEnabled")
                              ? "1"
                              : "0.5",
                          }}
                        >
                          <Field
                            label="Tuning parameter"
                            type="number"
                            className={`ml-2`}
                            containerClassName="mb-0"
                            min="0"
                            disabled={
                              !hasCommercialFeature("sequential-testing") ||
                              hasFileConfig
                            }
                            helpText={
                              <>
                                <span className="ml-2">
                                  ({DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                                  is default)
                                </span>
                              </>
                            }
                            {...register("sequentialTestingTuningParameter", {
                              valueAsNumber: true,
                              validate: (v) => {
                                return !(v <= 0);
                              },
                            })}
                          />
                        </div>
                      </div>
                    </Tab>
                  </ControlledTabs>
                </div>

                <h4 className="mt-4 mb-2">Sticky Bucketing Settings</h4>
                <div className="appbox py-2 px-3">
                  <div className="w-100 mt-2">
                    <div className="d-flex">
                      <label
                        className="mr-2"
                        htmlFor="toggle-useStickyBucketing"
                      >
                        <PremiumTooltip
                          commercialFeature={"sticky-bucketing"}
                          body={<StickyBucketingTooltip />}
                        >
                          Enable Sticky Bucketing <FaQuestionCircle />
                        </PremiumTooltip>
                      </label>
                      <Toggle
                        id={"toggle-useStickyBucketing"}
                        value={!!watch("useStickyBucketing")}
                        setValue={(value) => {
                          setValue(
                            "useStickyBucketing",
                            hasCommercialFeature("sticky-bucketing")
                              ? value
                              : false
                          );
                        }}
                        disabled={
                          !watch("useStickyBucketing") &&
                          (!hasCommercialFeature("sticky-bucketing") ||
                            !hasSDKWithStickyBucketing)
                        }
                      />
                    </div>
                    {!watch("useStickyBucketing") && (
                      <div className="small">
                        <StickyBucketingToggleWarning
                          hasSDKWithStickyBucketing={hasSDKWithStickyBucketing}
                        />
                      </div>
                    )}
                  </div>

                  {watch("useStickyBucketing") && (
                    <div className="w-100 mt-4">
                      <div className="d-flex">
                        <label
                          className="mr-2"
                          htmlFor="toggle-useFallbackAttributes"
                        >
                          <Tooltip
                            body={
                              <>
                                <div className="mb-2">
                                  If the user&apos;s assignment attribute is not
                                  available a fallback attribute may be used
                                  instead. Toggle this to allow selection of a
                                  fallback attribute when creating experiments.
                                </div>
                                <div>
                                  While using a fallback attribute can improve
                                  the consistency of the user experience, it can
                                  also lead to statistical biases if not
                                  implemented carefully. See the Sticky
                                  Bucketing docs for more information.
                                </div>
                              </>
                            }
                          >
                            Enable fallback attributes in experiments{" "}
                            <FaQuestionCircle />
                          </Tooltip>
                        </label>
                        <Toggle
                          id={"toggle-useFallbackAttributes"}
                          value={!!watch("useFallbackAttributes")}
                          setValue={(value) =>
                            setValue("useFallbackAttributes", value)
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <h4 className="mt-4 mb-2">Experiment Health Settings</h4>
                <div className="appbox pt-2 px-3">
                  <div className="form-group mb-2 mt-2 mr-2 form-inline">
                    <label
                      className="mr-1"
                      htmlFor="toggle-runHealthTrafficQuery"
                    >
                      Run traffic query by default
                    </label>
                    <Toggle
                      id={"toggle-runHealthTrafficQuery"}
                      value={!!watch("runHealthTrafficQuery")}
                      setValue={(value) => {
                        setValue("runHealthTrafficQuery", value);
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
                      className={`ml-2`}
                      containerClassName="mb-3"
                      append=""
                      disabled={hasFileConfig}
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
                      {...register("srmThreshold", {
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
              <ExperimentCheckListModal
                close={() => setEditChecklistOpen(false)}
              />
            ) : null}
          </>
        );
      }}
    </ConnectSettingsForm>
  );
}
