import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { PValueCorrection } from "back-end/types/stats";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { FaExclamationTriangle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import { GBCuped, GBSequential } from "@/components/Icons";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import SelectField from "@/components/Forms/SelectField";
import Tab from "@/components/Tabs/Tab";
import Toggle from "@/components/Forms/Toggle";
import BayesianPriorSettings from "@/components/Settings/BayesianPriorSettings";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function StatsEngineSettings() {
  const form = useFormContext();

  const statsEngine = form.watch("statsEngine");
  const confidenceLevel = form.watch("confidenceLevel");
  const pValueThreshold = form.watch("pValueThreshold");
  const regressionAdjustmentDays = form.watch("regressionAdjustmentDays");

  const { hasCommercialFeature } = useUser();
  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    statsEngine || DEFAULT_STATS_ENGINE
  );

  // form loads values async, this updates the tab when it finally does
  useEffect(() => {
    setStatsEngineTab(statsEngine);
  }, [statsEngine]);

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

  return (
    <div className="mb-3 form-group flex-column align-items-start">
      <StatsEngineSelect
        label="Default Statistics Engine"
        allowUndefined={false}
        value={form.watch("statsEngine")}
        onChange={(value) => {
          form.setValue("statsEngine", value);
        }}
        labelClassName="mr-2"
      />

      <h4>Stats Engine Settings</h4>

      <ControlledTabs
        newStyle={true}
        className="mt-3"
        buttonsClassName="px-5"
        tabContentsClassName="border"
        active={statsEngineTab}
        setActive={(v) => setStatsEngineTab(v || DEFAULT_STATS_ENGINE)}
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
                backgroundColor: highlightColor ? highlightColor + "15" : "",
              }}
              className={`ml-2`}
              containerClassName="mb-3"
              append="%"
              disabled={hasFileConfig()}
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
              {...form.register("confidenceLevel", {
                valueAsNumber: true,
                min: 50,
                max: 100,
              })}
            />
          </div>
          <div className="p-3 my-3 border rounded">
            <h5 className="font-weight-bold mb-4">Priors</h5>
            <BayesianPriorSettings />
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
                backgroundColor: pHighlightColor ? pHighlightColor + "15" : "",
              }}
              className={`ml-2`}
              containerClassName="mb-3"
              append=""
              disabled={hasFileConfig()}
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
              {...form.register("pValueThreshold", {
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
              value={form.watch("pValueCorrection") ?? ""}
              onChange={(value) =>
                form.setValue("pValueCorrection", value as PValueCorrection)
              }
              sort={false}
              options={[
                {
                  label: "None",
                  value: "",
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
                  value={!!form.watch("regressionAdjustmentEnabled")}
                  setValue={(value) => {
                    form.setValue("regressionAdjustmentEnabled", value);
                  }}
                  disabled={
                    !hasCommercialFeature("regression-adjustment") ||
                    hasFileConfig()
                  }
                />
              </div>
              {form.watch("regressionAdjustmentEnabled") &&
                form.watch("statsEngine") === "bayesian" && (
                  <div className="d-flex">
                    <small className="mb-1 text-warning-orange">
                      <FaExclamationTriangle /> Your organization uses Bayesian
                      statistics by default and regression adjustment is not
                      implemented for the Bayesian engine.
                    </small>
                  </div>
                )}
            </div>
            <div
              className="form-group mt-3 mb-0 mr-2 form-inline"
              style={{
                opacity: form.watch("regressionAdjustmentEnabled")
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
                  hasFileConfig()
                }
                helpText={
                  <>
                    <span className="ml-2">
                      ({DEFAULT_REGRESSION_ADJUSTMENT_DAYS} is default)
                    </span>
                  </>
                }
                {...form.register("regressionAdjustmentDays", {
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
                  value={form.watch("sequentialTestingEnabled")}
                  setValue={(value) => {
                    form.setValue("sequentialTestingEnabled", value);
                  }}
                  disabled={
                    !hasCommercialFeature("sequential-testing") ||
                    hasFileConfig()
                  }
                />
              </div>
              {form.watch("sequentialTestingEnabled") &&
                form.watch("statsEngine") === "bayesian" && (
                  <div className="d-flex">
                    <small className="mb-1 text-warning-orange">
                      <FaExclamationTriangle /> Your organization uses Bayesian
                      statistics by default and sequential testing is not
                      implemented for the Bayesian engine.
                    </small>
                  </div>
                )}
            </div>
            <div
              className="form-group mt-3 mb-0 mr-2 form-inline"
              style={{
                opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
              }}
            >
              <Field
                label="Tuning parameter"
                type="number"
                className={`ml-2`}
                containerClassName="mb-0"
                min="0"
                disabled={
                  !hasCommercialFeature("sequential-testing") || hasFileConfig()
                }
                helpText={
                  <>
                    <span className="ml-2">
                      ({DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER} is default)
                    </span>
                  </>
                }
                {...form.register("sequentialTestingTuningParameter", {
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
  );
}
