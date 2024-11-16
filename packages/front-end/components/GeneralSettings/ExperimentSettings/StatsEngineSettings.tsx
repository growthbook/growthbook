import { useEffect, useState } from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { StatsEngine, PValueCorrection } from "back-end/types/stats";
import { MetricDefaults } from "back-end/types/organization";
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

  // 表单异步加载值，当值最终加载完成时更新选项卡
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
        ? "这已经是最低值了"
        : confidenceLevel < 75
          ? "不建议使用这么低的置信阈值"
          : confidenceLevel < 80
            ? "不建议使用这么低的置信阈值"
            : confidenceLevel < 90
              ? "使用低于90%的值时要小心"
              : confidenceLevel >= 99
                ? "达到99%及更高的置信水平可能需要大量数据"
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
        ? "这已经是最高值了"
        : pValueThreshold > 0.25
          ? "不建议使用这么高的P值阈值"
          : pValueThreshold > 0.2
            ? "不建议使用这么高的P值阈值"
            : pValueThreshold > 0.1
              ? "使用高于0.1的值时要小心"
              : pValueThreshold <= 0.01
                ? "达到0.01及更低的阈值可能需要大量数据"
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
        ? "较长的回溯期有时可能有用，但也会降低查询性能，并且可能包含不太有用的数据"
        : regressionAdjustmentDays < 7
          ? "7天以下的回溯期往往无法捕获足够的指标数据来降低方差，并且可能受到每周季节性的影响"
          : ""
      : "";

  return (
    <div className="mb-3 form-group flex-column align-items-start">
      <h4>统计引擎设置</h4>

      <StatsEngineSelect
        label="默认统计引擎"
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
        <Tab id="bayesian" display="贝叶斯">
          <BayesianTab
            {...{
              highlightColor,
              warningMsg,
              form,
            }}
          />
        </Tab>
        <Tab id="frequentist" display="频率学派">
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

      {/* <div className="p-3 my-3 border rounded">
        <h5 className="font-weight-bold mb-4">
          <PremiumTooltip commercialFeature="regression-adjustment">
            <GBCuped /> 回归调整（CUPED）
          </PremiumTooltip>
        </h5>
        <div className="form-group mb-0 mr-2">
          <div className="d-flex">
            <label
              className="mr-1"
              htmlFor="toggle-regressionAdjustmentEnabled"
            >
              默认应用回归调整
            </label>
            <Toggle
              id={"toggle-regressionAdjustmentEnabled"}
              value={!!form.watch("regressionAdjustmentEnabled")}
              setValue={(value) => {
                form.setValue("regressionAdjustmentEnabled", value);
              }}
              disabled={
                !hasCommercialFeature("regression-adjustment") || hasFileConfig()
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
            label="曝光前回溯期（天）"
            type="number"
            style={{
              borderColor: regressionAdjustmentDaysHighlightColor,
              backgroundColor: regressionAdjustmentDaysHighlightColor
                ? regressionAdjustmentDaysHighlightColor + "15"
                : "",
            }}
            className={`ml-2`}
            containerClassName="mb-0"
            append="天"
            min="0"
            max="100"
            disabled={
              !hasCommercialFeature("regression-adjustment") || hasFileConfig()
            }
            helpText={
              <>
                <span className="ml-2">
                  （{DEFAULT_REGRESSION_ADJUSTMENT_DAYS}为默认值）
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
      </div> */}
    </div>
  );
}