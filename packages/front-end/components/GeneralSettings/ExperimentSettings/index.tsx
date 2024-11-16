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
      ? "阈值高于0.01可能会导致误报增多，尤其是在您定期刷新结果的情况下。"
      : srmThreshold && srmThreshold < 0.001
        ? "阈值低于0.001可能会使得在流量不大的情况下难以检测到不平衡情况。"
        : "";

  return (
    <>
      <div className="row">
        <div className="col-sm-3">
          <h4>实验设置</h4>
        </div>

        <div className="col-sm-9">
          <div className="form-inline flex-column align-items-start mb-3">
            <Field
              label="导入过去实验时的最小实验时长（以天为单位）"
              type="number"
              className="ml-2"
              containerClassName="mb-3"
              append="天"
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
              label="当此百分比的实验用户处于多个变体中时发出警告"
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
                    默认转化窗口覆盖 <FaQuestionCircle />
                  </AttributionModelTooltip>
                }
                className="ml-2"
                value={form.watch("attributionModel")}
                onChange={(value) => {
                  form.setValue("attributionModel", value);
                }}
                options={[
                  {
                    label: "遵循转化窗口",
                    value: "firstExposure",
                  },
                  {
                    label: "忽略转化窗口",
                    value: "experimentDuration",
                  },
                ]}
              />
            </div>

            <div className="mb-4 form-group flex-column align-items-start">
              <Field
                label="实验自动更新频率"
                className="ml-2"
                containerClassName="mb-2 mr-2"
                disabled={hasFileConfig()}
                options={[
                  {
                    display: "当结果为X小时前",
                    value: "stale",
                  },
                  {
                    display: "定时任务计划",
                    value: "cron",
                  },
                  {
                    display: "从不",
                    value: "never",
                  },
                ]}
                {...form.register("updateSchedule.type")}
              />
              {form.watch("updateSchedule")?.type === "stale" && (
                <div className="bg-light p-3 border">
                  <Field
                    label="在结果为多少小时前刷新"
                    append="小时前"
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
                    label="定时任务字符串"
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

            {/* <div className="d-flex form-group mb-3">
              <label
                className="mr-1"
                htmlFor="toggle-factTableQueryOptimization"
              >
                <PremiumTooltip
                  commercialFeature="multi-metric-queries"
                  body={
                    <>
                      <p>
                        如果将来自同一事实表的多个指标添加到一个实验中，这将把它们合并为一个查询，这样会更快且更高效。
                      </p>
                      <p>
                        对于像BigQuery或SnowFlake这样基于使用量计费的数据源，这可以节省大量成本。
                      </p>
                    </>
                  }
                >
                  事实表查询优化{" "} <MdInfoOutline className="text-info" />
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
            </div> */}
          </div>

          <StatsEngineSettings />

          {/* <div className="d-flex form-group mb-3">
            <label className="mr-1" htmlFor="toggle-factTableQueryOptimization">
              <span className="badge badge-purple text-uppercase mr-2">
                测试版
              </span>
              启用功效计算器
            </label>
            <Toggle
              id="toggle-powerCalculator"
              value={form.watch("powerCalculatorEnabled")}
              setValue={(value) => {
                form.setValue("powerCalculatorEnabled", !!value);
              }}
            />
          </div> */}

          <StickyBucketingSettings />

          <h4 className="mt-4 mb-2">实验健康设置</h4>
          <div className="appbox pt-2 px-3">
            <div className="form-group mb-2 mt-2 mr-2 form-inline">
              <label className="mr-1" htmlFor="toggle-runHealthTrafficQuery">
                默认运行流量查询
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
                label="SRM p值阈值"
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
                    <span className="ml-2">(0.001为默认值)</span>
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

          {/* <div className="mb-3 form-group flex-column align-items-start">
            <PremiumTooltip
              commercialFeature="custom-launch-checklist"
              premiumText="企业客户可使用自定义启动前检查清单"
            >
              <div className="d-inline-block h4 mt-4 mb-0">
                实验启动前检查清单
              </div>
            </PremiumTooltip>
            <p className="pt-2">
              配置在启动实验之前需要完成的必需步骤。
            </p>
            <Button
              disabled={!hasCommercialFeature("custom-launch-checklist")}
              onClick={async () => {
                setEditChecklistOpen(true);
              }}
            >
              编辑检查清单
            </Button>
          </div> */}
        </div>
      </div>
      {editChecklistOpen ? (
        <ExperimentCheckListModal close={() => setEditChecklistOpen(false)} />
      ) : null}
    </>
  );
}