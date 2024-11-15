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
      ? "更新频率应当至少比运行数据仓库查询所需时间长15分钟"
      : scheduleHours > 24 * 3
        ? "更新间隔超过3天可能导致学习速度变慢"
        : null;

  // 添加一个变量来控制是否显示多臂老虎机设置的tab内容，这里设置为false表示屏蔽
  const shouldShowBanditSettingsTab = false;

  return (
    <div className="row">
      {page === "org-settings" && shouldShowBanditSettingsTab && (
        <div className="col-sm-3">
          <h4>多臂老虎机设置</h4>
        </div>
      )}
      <div
        className={clsx({
          "col-sm-9": page === "org-settings" && shouldShowBanditSettingsTab,
          "col mb-2": page === "experiment-settings" && shouldShowBanditSettingsTab,
        })}
      >
        {page === "org-settings" && shouldShowBanditSettingsTab && (
          <>
            <PremiumTooltip
              commercialFeature="multi-armed-bandits"
              premiumText="多臂老虎机是专业版功能"
            >
              <div className="d-inline-block h5 mb-0">多臂老虎机默认值</div>
            </PremiumTooltip>
            <p className="mt-2">
              这些是用于配置多臂老虎机的组织默认值。您始终可以根据每个实验的情况来更改这些值。
            </p>
          </>
        )}

        {shouldShowBanditSettingsTab && (
          <div className="d-flex">
            <div className="col-6 pl-0">
              <label
                className={clsx("mb-0", {
                  "font-weight-bold": page === "experiment-settings",
                })}
              >
                探索阶段
              </label>
              <div className="small text-muted mb-2">
                变体权重更新前的时间段：
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
                        label: "小时",
                        value: "hours",
                      },
                      {
                        label: "天",
                        value: "days",
                      },
                    ]}
                    disabled={!hasBandits || lockExploratoryStage}
                  />
                </div>
              </div>
              {page === "experiment-settings" && (
                <div className="text-muted small mt-1">
                  默认值：{" "}
                  <strong>
                    {settings?.banditBurnInValue?.value ?? 1}{" "}
                    {settings?.banditBurnInUnit?.value ?? "days"}
                  </strong>
                </div>
              )}
              {lockExploratoryStage && page === "experiment-settings" && (
                <HelperText status="info">
                  探索阶段已经结束
                </HelperText>
              )}
            </div>

            <div className="col-6 pr-0">
              <label
                className={clsx("mb-0", {
                  "font-weight-bold": page === "experiment-settings",
                })}
              >
                更新频率
              </label>
              <div className="small text-muted mb-2">
                每隔多久更新一次变体权重：
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
                        label: "小时",
                        value: "hours",
                      },
                      {
                        label: "天",
                        value: "days",
                      },
                    ]}
                    disabled={!hasBandits}
                  />
                </div>
                {page === "experiment-settings" && (
                  <div className="text-muted small mt-1">
                    默认值：{" "}
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
        )}
      </div>
    </div>
  );
}