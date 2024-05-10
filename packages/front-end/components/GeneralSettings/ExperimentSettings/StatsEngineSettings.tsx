import { useEffect, useState } from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { StatsEngine, PValueCorrection } from "back-end/types/stats";
import { MetricDefaults } from "@back-end/types/organization";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import Tab from "@/components/Tabs/Tab";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import FrequentistTab from "./FrequentistTab";
import BayesianTab from "./BayesianTab";

interface FormValues {
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  confidenceLevel: number;
  pValueThreshold: number;
  pValueCorrection: PValueCorrection;
  sequentialTestingTuningParameter: number;
  sequentialTestingEnabled: boolean;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;
}

export type StatsEngineSettingsForm = UseFormReturn<FormValues>;

export default function StatsEngineSettings() {
  const form = useFormContext<FormValues>();

  const statsEngine = form.watch("statsEngine");
  const confidenceLevel = form.watch("confidenceLevel");
  const pValueThreshold = form.watch("pValueThreshold");
  const regressionAdjustmentDays = form.watch("regressionAdjustmentDays");

  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    statsEngine || DEFAULT_STATS_ENGINE
  );

  const { hasCommercialFeature } = useUser();

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
      <h4>Stats Engine Settings</h4>

      <StatsEngineSelect
        label="Default Statistics Engine"
        allowUndefined={false}
        value={form.watch("statsEngine")}
        onChange={(value) => {
          form.setValue("statsEngine", value);
        }}
        labelClassName="mr-2"
      />

      <ControlledTabs
        newStyle={true}
        className="mt-3"
        buttonsClassName="px-5"
        tabContentsClassName="border"
        active={statsEngineTab}
        setActive={(v) => setStatsEngineTab(v || DEFAULT_STATS_ENGINE)}
      >
        <Tab id="bayesian" display="Bayesian">
          <BayesianTab
            {...{
              highlightColor,
              warningMsg,
              form,
            }}
          />
        </Tab>
        <Tab id="frequentist" display="Frequentist">
          <FrequentistTab
            {...{
              pHighlightColor,
              pWarningMsg,
              regressionAdjustmentDaysHighlightColor,
              regressionAdjustmentDaysWarningMsg,
              form,
            }}
          />
        </Tab>
      </ControlledTabs>

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
        </div>
        <div
          className="form-group mt-3 mb-0 mr-2 form-inline"
          style={{
            opacity: form.watch("regressionAdjustmentEnabled") ? "1" : "0.5",
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
              !hasCommercialFeature("regression-adjustment") || hasFileConfig()
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
    </div>
  );
}
