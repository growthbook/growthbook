import React, { FC, useCallback, useState } from "react";
import {
  UseFormReturn,
  useFieldArray,
  useForm,
  FormProvider,
} from "react-hook-form";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { FaQuestionCircle } from "react-icons/fa";
import { getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  getAffectedEnvsForExperiment,
  isProjectListValidForProject,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { GBCuped, GBSequential } from "@/components/Icons";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import HelperText from "@/components/Radix/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import { AttributionModelTooltip } from "./AttributionModelTooltip";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import { MetricsSelectorTooltip } from "./MetricsSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  cancel: () => void;
  mutate: () => void;
  editVariationIds?: boolean;
  editDates?: boolean;
  editMetrics?: boolean;
  source?: string;
}> = ({
  experiment,
  cancel,
  mutate,
  phase,
  source,
  editVariationIds = true,
  editDates = true,
  editMetrics = false,
}) => {
    const {
      segments,
      getProjectById,
      getDatasourceById,
      getExperimentMetricById,
      getSegmentById,
      datasources,
    } = useDefinitions();

    const { organization, hasCommercialFeature } = useUser();

    const permissionsUtil = usePermissionsUtil();

    const orgSettings = useOrgSettings();

    const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");
    const [hasMetricOverrideRiskError, setHasMetricOverrideRiskError] = useState(
      false
    );
    const [upgradeModal, setUpgradeModal] = useState(false);

    const pid = experiment?.project;
    const project = pid ? getProjectById(pid) : null;

    const { settings: scopedSettings } = getScopedSettings({
      organization,
      project: project ?? undefined,
    });

    const hasRegressionAdjustmentFeature = hasCommercialFeature(
      "regression-adjustment"
    );
    const hasSequentialTestingFeature = hasCommercialFeature(
      "sequential-testing"
    );

    let canRunExperiment = !experiment.archived;
    const envs = getAffectedEnvsForExperiment({ experiment });
    if (envs.length > 0) {
      if (!permissionsUtil.canRunExperiment(experiment, envs)) {
        canRunExperiment = false;
      }
    }

    const phaseObj = experiment.phases[phase];

    const form = useForm({
      defaultValues: {
        trackingKey: experiment.trackingKey || "",
        datasource: experiment.datasource || "",
        exposureQueryId:
          getExposureQuery(
            getDatasourceById(experiment.datasource)?.settings,
            experiment.exposureQueryId,
            experiment.userIdType
          )?.id || "",
        activationMetric: experiment.activationMetric || "",
        segment: experiment.segment || "",
        queryFilter: experiment.queryFilter || "",
        skipPartialData: experiment.skipPartialData ? "strict" : "loose",
        attributionModel:
          experiment.attributionModel ||
          orgSettings.attributionModel ||
          "firstExposure",
        dateStarted: getValidDate(phaseObj?.dateStarted ?? "")
          .toISOString()
          .substr(0, 16),
        dateEnded: getValidDate(phaseObj?.dateEnded ?? "")
          .toISOString()
          .substr(0, 16),
        variations: experiment.variations || [],
        phases: experiment.phases || [],
        sequentialTestingEnabled:
          hasSequentialTestingFeature &&
            experiment.sequentialTestingEnabled !== undefined
            ? experiment.sequentialTestingEnabled
            : !!orgSettings.sequentialTestingEnabled,
        sequentialTestingTuningParameter:
          experiment.sequentialTestingEnabled !== undefined
            ? experiment.sequentialTestingTuningParameter
            : orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
        goalMetrics: experiment.goalMetrics,
        guardrailMetrics: experiment.guardrailMetrics || [],
        secondaryMetrics: experiment.secondaryMetrics || [],
        metricOverrides: getDefaultMetricOverridesFormValue(
          experiment.metricOverrides || [],
          getExperimentMetricById,
          orgSettings
        ),
        statsEngine: experiment.statsEngine,
        regressionAdjustmentEnabled: experiment.regressionAdjustmentEnabled,
        type: experiment.type || "standard",
        banditScheduleValue:
          experiment.banditScheduleValue ??
          scopedSettings.banditScheduleValue.value,
        banditScheduleUnit:
          experiment.banditScheduleUnit ??
          scopedSettings.banditScheduleUnit.value,
        banditBurnInValue:
          experiment.banditBurnInValue ?? scopedSettings.banditBurnInValue.value,
        banditBurnInUnit:
          experiment.banditBurnInUnit ?? scopedSettings.banditBurnInUnit.value,
      },
    });

    const [
      usingSequentialTestingDefault,
      setUsingSequentialTestingDefault,
    ] = useState(experiment.sequentialTestingEnabled === undefined);
    const setSequentialTestingToDefault = useCallback(
      (enable: boolean) => {
        if (enable) {
          form.setValue(
            "sequentialTestingEnabled",
            !!orgSettings.sequentialTestingEnabled
          );
          form.setValue(
            "sequentialTestingTuningParameter",
            orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
          );
        }
        setUsingSequentialTestingDefault(enable);
      },
      [
        form,
        setUsingSequentialTestingDefault,
        orgSettings.sequentialTestingEnabled,
        orgSettings.sequentialTestingTuningParameter,
      ]
    );

    const { apiCall } = useAuth();

    const datasource = getDatasourceById(form.watch("datasource"));
    const datasourceProperties = datasource?.properties;

    const filteredSegments = segments.filter(
      (s) => s.datasource === datasource?.id
    );

    // Error: Type instantiation is excessively deep and possibly infinite.
    const variations = useFieldArray({
      control: form.control,
      name: "variations",
    });

    const exposureQueries = datasource?.settings?.queries?.exposure || [];
    const exposureQueryId = form.watch("exposureQueryId");
    const exposureQuery = exposureQueries.find((e) => e.id === exposureQueryId);

    const type = form.watch("type");
    const isBandit = type === "multi-armed-bandit";

    if (upgradeModal) {
      return (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason="为了覆盖指标转换窗口，"
          source="override-metrics"
        />
      );
    }

    const hasMetrics =
      form.watch("goalMetrics").length > 0 ||
      form.watch("guardrailMetrics").length > 0 ||
      form.watch("secondaryMetrics").length > 0;

    return (
      <Modal
        trackingEventModalType="analysis-form"
        trackingEventModalSource={source}
        header={"实验设置"}
        open={true}
        close={cancel}
        size="lg"
        ctaEnabled={!editMetrics || !hasMetricOverrideRiskError}
        submit={form.handleSubmit(async (value) => {
          const { dateStarted, dateEnded, skipPartialData, ...values } = value;

          const body: Partial<ExperimentInterfaceStringDates> & {
            phaseStartDate: string;
            phaseEndDate?: string;
            currentPhase?: number;
          } = {
            ...values,
            currentPhase: phase,
            phaseStartDate: dateStarted,
            skipPartialData: skipPartialData === "strict",
          };

          fixMetricOverridesBeforeSaving(body.metricOverrides || []);

          if (experiment.status === "stopped") {
            body.phaseEndDate = dateEnded;
          }
          if (usingSequentialTestingDefault) {
            // User checked the org default checkbox; ignore form values
            body.sequentialTestingEnabled = !!orgSettings.sequentialTestingEnabled;
            body.sequentialTestingTuningParameter =
              orgSettings.sequentialTestingTuningParameter ??
              DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
          }

          // bandits
          if (
            body.type === "multi-armed-bandit" &&
            !hasCommercialFeature("multi-armed-bandits")
          ) {
            throw new Error("多臂老虎机是高级功能");
          }
          if (body.type === "multi-armed-bandit") {
            body.statsEngine = "bayesian";
            if (!body.datasource) {
              throw new Error("您必须选择一个数据源");
            }
            if ((body.goalMetrics?.length ?? 0) !== 1) {
              throw new Error("您必须选择一个决策指标");
            }
            const phaseId = (body.phases?.length ?? 0) - 1;
            if (body.phases?.[phaseId] && body.variations) {
              body.phases[phaseId].variationWeights = body.variations.map(
                () => 1 / (body?.variations?.length || 2)
              );
            }
            const banditScheduleHours =
              (body.banditScheduleValue ?? 0) *
              (body.banditScheduleUnit === "days" ? 24 : 1);
            if (banditScheduleHours < 0.25 || (body.banditBurnInValue ?? 0) < 0) {
              throw new Error("无效的多臂老虎机计划");
            }
          }

          await apiCall(`/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          mutate();
        })}
        cta="保存"
      >
        <div className="mx-2">
          {isBandit && (
            <FormProvider {...form}>
              <BanditSettings
                page="experiment-settings"
                settings={scopedSettings}
                lockExploratoryStage={experiment.banditStage === "exploit"}
              />
              <hr className="my-3" />
              {experiment.status === "running" && (
                <HelperText status="info" mb="4">
                  由于多臂老虎机已处于运行状态，以下设置无法修改
                </HelperText>
              )}
            </FormProvider>
          )}

          <SelectField
            label="数据源"
            labelClassName="font-weight-bold"
            value={datasource?.id || ""}
            disabled={isBandit && experiment.status !== "draft"}
            onChange={(newDatasource) => {
              form.setValue("datasource", newDatasource);

              // If unsetting the datasource, leave all the other settings alone
              // That way, it will be restored if the user switches back to the previous value
              if (!newDatasource) {
                return;
              }

              // If the exposure query is now invalid
              const ds = getDatasourceById(newDatasource);
              if (
                !getExposureQuery(ds?.settings, form.watch("exposureQueryId"))
              ) {
                form.setValue("exposureQueryId", "");
              }

              // If the segment is now invalid
              const segment = form.watch("segment");
              if (
                segment &&
                getSegmentById(segment)?.datasource !== newDatasource
              ) {
                form.setValue("segment", "");
              }

              const isValidMetric = (id: string) =>
                getExperimentMetricById(id)?.datasource === newDatasource;

              // If the activationMetric is now invalid
              const activationMetric = form.watch("activationMetric");
              if (activationMetric && !isValidMetric(activationMetric)) {
                form.setValue("activationMetric", "");
              }

              // Filter the selected metrics to only valid ones
              const goals = form.watch("goalMetrics");
              form.setValue("goalMetrics", goals.filter(isValidMetric));

              const secondaryMetrics = form.watch("secondaryMetrics");
              form.setValue(
                "secondaryMetrics",
                secondaryMetrics.filter(isValidMetric)
              );

              const guardrails = form.watch("guardrailMetrics");
              form.setValue("guardrailMetrics", guardrails.filter(isValidMetric));
            }}
            options={datasources
              .filter(
                (ds) =>
                  ds.id === experiment.datasource ||
                  isProjectListValidForProject(ds.projects, experiment.project)
              )
              .map((d) => ({
                value: d.id,
                label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
              }))}
            className="portal-overflow-ellipsis"
            helpText={
              <>
                <strong className="text-danger">警告：</strong>更改此项将从实验中移除所有指标和细分。
              </>
            }
          />
          {datasource?.properties?.exposureQueries && (
            <SelectField
              label={
                <>
                  实验分配表{" "}
                  <Tooltip body="应与用于为本实验随机分配单元的标识符类型相对应" />
                </>
              }
              labelClassName="font-weight-bold"
              value={form.watch("exposureQueryId") ?? ""}
              onChange={(v) => form.setValue("exposureQueryId", v)}
              required
              disabled={isBandit && experiment.status !== "draft"}
              initialOption="选择..."
              options={exposureQueries?.map((q) => {
                return {
                  label: q.name,
                  value: q.id,
                };
              })}
              formatOptionLabel={({ label, value }) => {
                const userIdType = exposureQueries?.find((e) => e.id === value)
                  ?.userIdType;
                return (
                  <>
                    {label}
                    {userIdType ? (
                      <span
                        className="text-muted small float-right position-relative"
                        style={{ top: 3 }}
                      >
                        标识符类型：<code>{userIdType}</code>
                      </span>
                    ) : null}
                  </>
                );
              }}
            />
          )}
          {datasource && (
            <Field
              label="追踪Key"
              labelClassName="font-weight-bold"
              {...form.register("trackingKey")}
              helpText={
                <>
                  本实验的唯一标识符，用于跟踪展示次数和分析结果。将与您的数据源中的{" "}
                  <code>experiment_id</code>列匹配。
                </>
              }
              disabled={
                !canRunExperiment || (isBandit && experiment.status !== "draft")
              }
            />
          )}
          {editVariationIds && (
            <div className="form-group">
              <label className="font-weight-bold">版本ID</label>
              <div className="row align-items-top">
                {variations.fields.map((v, i) => (
                  <div
                    className={`col-${Math.max(
                      Math.round(12 / variations.fields.length),
                      3
                    )} mb-2`}
                    key={i}
                  >
                    <Field
                      label={v.name}
                      labelClassName="mb-0"
                      containerClassName="mb-1"
                      {...form.register(`variations.${i}.key`)}
                      placeholder={i + ""}
                    />
                  </div>
                ))}
              </div>
              <small className="form-text text-muted">
                将与您的数据源中的版本_id列匹配。
              </small>
            </div>
          )}
          {!!phaseObj && editDates && !isBandit && (
            <div className="row">
              <div className="col">
                <Field
                  label="开始日期（UTC）"
                  labelClassName="font-weight-bold"
                  type="datetime-local"
                  {...form.register("dateStarted")}
                  helpText="仅包含在此日期或之后进入实验的用户"
                />
              </div>
              {experiment.status === "stopped" && (
                <div className="col">
                  <Field
                    label="结束日期（UTC）"
                    labelClassName="font-weight-bold"
                    type="datetime-local"
                    {...form.register("dateEnded")}
                    helpText="仅包含在此日期或之前进入实验的用户"
                  />
                </div>
              )}
            </div>
          )}
          {!!datasource && !isBandit && (
            <MetricSelector
              datasource={form.watch("datasource")}
              exposureQueryId={exposureQueryId}
              project={experiment.project}
              includeFacts={true}
              labelClassName="font-weight-bold"
              label={
                <>
                  激活指标 <MetricsSelectorTooltip onlyBinomial={true} />
                </>
              }
              initialOption="无"
              onlyBinomial
              value={form.watch("activationMetric")}
              onChange={(value) => form.setValue("activationMetric", value || "")}
              helpText="用户必须在此指标上完成转化才能被包含在内"
            />
          )}
          {datasourceProperties?.experimentSegments && !isBandit && (
            <SelectField
              label="细分"
              labelClassName="font-weight-bold"
              value={form.watch("segment")}
              onChange={(value) => form.setValue("segment", value || "")}
              initialOption="无（所有用户）"
              options={filteredSegments.map((s) => {
                return {
                  label: s.name,
                  value: s.id,
                };
              })}
              helpText="仅包含在此细分中的用户"
            />
          )}
          {datasourceProperties?.separateExperimentResultQueries && !isBandit && (
            <SelectField
              label="指标转换窗口设置"
              labelClassName="font-weight-bold"
              value={form.watch("skipPartialData")}
              onChange={(value) => form.setValue("skipPartialData", value)}
              options={[
                {
                  label: "包含正在进行的转化数据",
                  value: "loose",
                },
                {
                  label: "排除正在进行的转化数据",
                  value: "strict",
                },
              ]}
              helpText="针对未在实验中参与足够时长以完成转化窗口的用户，应如何处理。"
            />
          )}
          {datasourceProperties?.separateExperimentResultQueries && !isBandit && (
            <SelectField
              label={
                <AttributionModelTooltip>
                  <strong>转化窗口覆盖设置</strong> <FaQuestionCircle />
                </AttributionModelTooltip>
              }
              value={form.watch("attributionModel")}
              onChange={(value) => {
                const model = value as AttributionModel;
                form.setValue("attributionModel", model);
              }}
              options={[
                {
                  label: "遵循转化窗口设置",
                  value: "firstExposure",
                },
                {
                  label: "忽略转化窗口设置",
                  value: "experimentDuration",
                },
              ]}
            />
          )}
          <StatsEngineSelect
            label={
              isBandit ? (
                <>
                  <div>统计引擎相关设置</div>
                  <div className="small text-muted">
                    对于多臂老虎机实验而言，仅 <strong>贝叶斯</strong> 统计引擎可用。
                  </div>
                </>
              ) : undefined
            }
            value={form.watch("statsEngine")}
            onChange={(v) => {
              form.setValue("statsEngine", v);
            }}
            parentSettings={scopedSettings}
            allowUndefined={!isBandit}
            disabled={isBandit}
          />
          {isBandit && (
            <SelectField
              label={
                <PremiumTooltip commercialFeature="regression-adjustment">
                  <GBCuped /> 使用回归调整（CUPED）功能
                </PremiumTooltip>
              }
              style={{ width: 200 }}
              labelClassName="font-weight-bold"
              value={form.watch("regressionAdjustmentEnabled") ? "on" : "off"}
              onChange={(v) => {
                form.setValue("regressionAdjustmentEnabled", v === "on");
              }}
              options={[
                {
                  label: "开启",
                  value: "on",
                },
                {
                  label: "关闭",
                  value: "off",
                },
              ]}
              disabled={
                !hasRegressionAdjustmentFeature ||
                (isBandit && experiment.status !== "draft")
              }
            />
          )}
          {(form.watch("statsEngine") || scopedSettings.statsEngine.value) ===
            "frequentist" &&
            !isBandit && (
              <div className="d-flex flex-row no-gutters align-items-top">
                <div className="col-5">
                  <SelectField
                    label={
                      <PremiumTooltip commercialFeature="sequential-testing">
                        <GBSequential /> 使用序贯检验功能
                      </PremiumTooltip>
                    }
                    labelClassName="font-weight-bold"
                    value={form.watch("sequentialTestingEnabled") ? "on" : "off"}
                    onChange={(v) => {
                      form.setValue("sequentialTestingEnabled", v === "on");
                    }}
                    options={[
                      {
                        label: "开启",
                        value: "on",
                      },
                      {
                        label: "关闭",
                        value: "off",
                      },
                    ]}
                    helpText="仅适用于频率学派分析"
                    disabled={
                      !hasSequentialTestingFeature ||
                      usingSequentialTestingDefault
                    }
                  />
                </div>
                <div
                  className="col-3 pl-4"
                  style={{
                    opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
                  }}
                >
                  <Field
                    label="调整参数设置"
                    type="number"
                    containerClassName="mb-0"
                    min="0"
                    disabled={
                      usingSequentialTestingDefault ||
                      !hasSequentialTestingFeature ||
                      hasFileConfig()
                    }
                    helpText={
                      <>
                        <span className="ml-2">
                          (
                          {orgSettings.sequentialTestingTuningParameter ??
                            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                          为默认值)
                        </span>
                      </>
                    }
                    {...form.register("sequentialTestingTuningParameter", {
                      valueAsNumber: true,
                      validate: (v) => {
                        return !((v ?? 0) <= 0);
                      },
                    })}
                  />
                </div>
                <div className="col align-self-center">
                  <label className="ml-5">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={usingSequentialTestingDefault}
                      disabled={!hasSequentialTestingFeature}
                      onChange={(e) =>
                        setSequentialTestingToDefault(e.target.checked)
                      }
                    />
                    重置为组织默认设置
                  </label>
                </div>
              </div>
            )}
          {datasourceProperties?.queryLanguage === "sql" && !isBandit && (
            <div className="row">
              <div className="col">
                <Field
                  label="自定义SQL筛选条件设置"
                  labelClassName="font-weight-bold"
                  {...form.register("queryFilter")}
                  textarea
                  placeholder="e.g. user_id NOT IN ('123', '456')"
                  helpText="添加到默认实验查询的WHERE子句内容"
                />
              </div>
              <div className="pt-2 border-left col-sm-4 col-lg-6">
                Available columns:
                <div className="mb-2 d-flex flex-wrap">
                  {["timestamp", "variation_id"]
                    .concat(exposureQuery ? [exposureQuery.userIdType] : [])
                    .concat(exposureQuery?.dimensions || [])
                    .map((d) => {
                      return (
                        <div className="mr-2 mb-2 border px-1" key={d}>
                          <code>{d}</code>
                        </div>
                      );
                    })}
                </div>
                <div>
                  <strong>提示：</strong> 在 <code>IN</code> 或 <code>NOT IN</code> 子句中使用子查询可实现更高级的筛选功能。
                </div>
              </div>
            </div>
          )}
          {editMetrics && (
            <>
              <ExperimentMetricsSelector
                datasource={form.watch("datasource")}
                exposureQueryId={exposureQueryId}
                project={experiment.project}
                goalMetrics={form.watch("goalMetrics")}
                secondaryMetrics={form.watch("secondaryMetrics")}
                guardrailMetrics={form.watch("guardrailMetrics")}
                setGoalMetrics={(goalMetrics) =>
                  form.setValue("goalMetrics", goalMetrics)
                }
                setSecondaryMetrics={(secondaryMetrics) =>
                  form.setValue("secondaryMetrics", secondaryMetrics)
                }
                setGuardrailMetrics={(guardrailMetrics) =>
                  form.setValue("guardrailMetrics", guardrailMetrics)
                }
                forceSingleGoalMetric={isBandit}
                noPercentileGoalMetrics={isBandit}
                goalDisabled={isBandit && experiment.status !== "draft"}
              />

              {hasMetrics && !isBandit && (
                <div className="form-group mb-2">
                  <PremiumTooltip commercialFeature="override-metrics">
                    指标覆盖设置（可选）
                  </PremiumTooltip>
                  <div className="mb-2 font-italic" style={{ fontSize: 12 }}>
                    <p className="mb-0">
                      在本实验中覆盖指标的相关行为设置。
                    </p>
                    <p className="mb-0">
                      若不想覆盖某些字段，可将其留空。
                    </p>
                  </div>
                  <MetricsOverridesSelector
                    experiment={experiment}
                    form={
                      (form as unknown) as UseFormReturn<EditMetricsFormInterface>
                    }
                    disabled={!hasOverrideMetricsFeature}
                    setHasMetricOverrideRiskError={(v: boolean) =>
                      setHasMetricOverrideRiskError(v)
                    }
                  />
                  {!hasOverrideMetricsFeature && (
                    <UpgradeMessage
                      showUpgradeModal={() => setUpgradeModal(true)}
                      commercialFeature="override-metrics"
                      upgradeMessage="override metrics"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    );
  };

export default AnalysisForm;
