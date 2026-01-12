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
} from "shared/types/experiment";
import { FaQuestionCircle } from "react-icons/fa";
import { PiCaretRightFill } from "react-icons/pi";
import { datetime, getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { isProjectListValidForProject } from "shared/util";
import { getScopedSettings } from "shared/settings";
import Collapsible from "react-collapsible";
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
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import DatePicker from "@/components/DatePicker";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { AttributionModelTooltip } from "./AttributionModelTooltip";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import { MetricsSelectorTooltip } from "./MetricsSelector";
import CustomMetricSlicesSelector from "./CustomMetricSlicesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  phase: number;
  cancel: () => void;
  mutate: () => void;
  editVariationIds?: boolean;
  editDates?: boolean;
  editMetrics?: boolean;
  source?: string;
}> = ({
  experiment,
  envs,
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
  const [hasMetricOverrideRiskError, setHasMetricOverrideRiskError] =
    useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);

  const pid = experiment?.project;
  const project = pid ? getProjectById(pid) : null;

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment,
  });

  // Get parent settings (without experiment scope) for displaying defaults
  const { settings: parentScopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
  });

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasPostStratificationFeature = hasCommercialFeature(
    "post-stratification",
  );
  const hasSequentialTestingFeature =
    hasCommercialFeature("sequential-testing");

  let canRunExperiment = !experiment.archived;
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
          experiment.userIdType,
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
          : (orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER),
      goalMetrics: experiment.goalMetrics,
      guardrailMetrics: experiment.guardrailMetrics || [],
      secondaryMetrics: experiment.secondaryMetrics || [],
      customMetricSlices: experiment.customMetricSlices || [],
      pinnedMetricSlices: experiment.pinnedMetricSlices || [],
      metricOverrides: getDefaultMetricOverridesFormValue(
        experiment.metricOverrides || [],
        getExperimentMetricById,
        orgSettings,
      ),
      statsEngine: experiment.statsEngine,
      regressionAdjustmentEnabled: experiment.regressionAdjustmentEnabled,
      postStratificationEnabled: experiment.postStratificationEnabled,
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

  const [usingSequentialTestingDefault, setUsingSequentialTestingDefault] =
    useState(experiment.sequentialTestingEnabled === undefined);
  const setSequentialTestingToDefault = useCallback(
    (enable: boolean) => {
      if (enable) {
        form.setValue(
          "sequentialTestingEnabled",
          !!orgSettings.sequentialTestingEnabled,
        );
        form.setValue(
          "sequentialTestingTuningParameter",
          orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
        );
      }
      setUsingSequentialTestingDefault(enable);
    },
    [
      form,
      setUsingSequentialTestingDefault,
      orgSettings.sequentialTestingEnabled,
      orgSettings.sequentialTestingTuningParameter,
    ],
  );

  const { apiCall } = useAuth();

  const datasource = getDatasourceById(form.watch("datasource"));
  const datasourceProperties = datasource?.properties;

  const filteredSegments = segments.filter(
    (s) => s.datasource === datasource?.id,
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
  const isHoldout = type === "holdout";

  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
    );

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        source="override-metrics"
        commercialFeature="override-metrics"
      />
    );
  }

  const hasMetrics =
    form.watch("goalMetrics").length > 0 ||
    form.watch("guardrailMetrics").length > 0 ||
    form.watch("secondaryMetrics").length > 0;

  // Check if any advanced settings should be shown
  const hasAdvancedSettings =
    !isBandit &&
    !isHoldout &&
    (datasourceProperties?.experimentSegments ||
      datasourceProperties?.separateExperimentResultQueries ||
      datasourceProperties?.queryLanguage === "sql" ||
      hasMetrics);

  return (
    <Modal
      trackingEventModalType="analysis-form"
      trackingEventModalSource={source}
      header={isHoldout ? "Analysis Settings" : "Experiment Settings"}
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
          body.sequentialTestingEnabled =
            !!orgSettings.sequentialTestingEnabled;
          body.sequentialTestingTuningParameter =
            orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
        }

        // bandits
        if (
          body.type === "multi-armed-bandit" &&
          !hasCommercialFeature("multi-armed-bandits")
        ) {
          throw new Error("Bandits are a premium feature");
        }
        if (body.type === "multi-armed-bandit") {
          body.statsEngine = "bayesian";
          if (!body.datasource) {
            throw new Error("You must select a datasource");
          }
          if ((body.goalMetrics?.length ?? 0) !== 1) {
            throw new Error("You must select 1 decision metric");
          }
          const phaseId = (body.phases?.length ?? 0) - 1;
          if (body.phases?.[phaseId] && body.variations) {
            body.phases[phaseId].variationWeights = body.variations.map(
              () => 1 / (body?.variations?.length || 2),
            );
          }
          const banditScheduleHours =
            (body.banditScheduleValue ?? 0) *
            (body.banditScheduleUnit === "days" ? 24 : 1);
          if (banditScheduleHours < 0.25 || (body.banditBurnInValue ?? 0) < 0) {
            throw new Error("Invalid Bandit schedule");
          }
        }

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        mutate();
      })}
      cta="Save"
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
                The following settings cannot be modified because the Bandit is
                already live
              </HelperText>
            )}
          </FormProvider>
        )}

        <SelectField
          label="Data Source"
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
              secondaryMetrics.filter(isValidMetric),
            );

            const guardrails = form.watch("guardrailMetrics");
            form.setValue("guardrailMetrics", guardrails.filter(isValidMetric));
          }}
          options={datasources
            .filter(
              (ds) =>
                ds.id === experiment.datasource ||
                isProjectListValidForProject(ds.projects, experiment.project),
            )
            .map((d) => ({
              value: d.id,
              label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
            }))}
          className="portal-overflow-ellipsis"
          helpText={
            <>
              <strong className="text-danger">Warning:</strong> Changing this
              will remove all metrics and segments from the experiment.
            </>
          }
        />
        {datasource?.properties?.exposureQueries && (
          <SelectField
            label={
              <>
                Experiment Assignment Table{" "}
                <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
              </>
            }
            labelClassName="font-weight-bold"
            value={form.watch("exposureQueryId") ?? ""}
            onChange={(v) => form.setValue("exposureQueryId", v)}
            required
            disabled={isBandit && experiment.status !== "draft"}
            initialOption="Choose..."
            options={exposureQueries?.map((q) => {
              return {
                label: q.name,
                value: q.id,
              };
            })}
            formatOptionLabel={({ label, value }) => {
              const userIdType = exposureQueries?.find(
                (e) => e.id === value,
              )?.userIdType;
              return (
                <>
                  {label}
                  {userIdType ? (
                    <span
                      className="text-muted small float-right position-relative"
                      style={{ top: 3 }}
                    >
                      Identifier Type: <code>{userIdType}</code>
                    </span>
                  ) : null}
                </>
              );
            }}
          />
        )}
        {datasource && !isHoldout && (
          <Field
            label="Tracking Key"
            labelClassName="font-weight-bold"
            {...form.register("trackingKey")}
            helpText={
              <>
                Unique identifier for this experiment, used to track impressions
                and analyze results. Will match against the{" "}
                <code>experiment_id</code> column in your data source.
              </>
            }
            disabled={
              !canRunExperiment || (isBandit && experiment.status !== "draft")
            }
          />
        )}
        {editVariationIds && (
          <div className="form-group">
            <label className="font-weight-bold">Variation Ids</label>
            <div className="row align-items-top">
              {variations.fields.map((v, i) => (
                <div
                  className={`col-${Math.max(
                    Math.round(12 / variations.fields.length),
                    3,
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
              Will match against the variation_id column in your data source
            </small>
          </div>
        )}
        {!!phaseObj && editDates && !isBandit && !isHoldout && (
          <div className="row">
            <div className="col">
              <DatePicker
                label="Start Time (UTC)"
                helpText="Only include users who entered the experiment on or after this date"
                date={form.watch("dateStarted")}
                setDate={(v) => {
                  form.setValue("dateStarted", v ? datetime(v) : "");
                }}
                scheduleEndDate={form.watch("dateEnded")}
                disableAfter={form.watch("dateEnded") || undefined}
              />
            </div>
            {experiment.status === "stopped" && (
              <div className="col">
                <DatePicker
                  label="End Time (UTC)"
                  helpText="Only include users who entered the experiment on or before this date"
                  date={form.watch("dateEnded")}
                  setDate={(v) => {
                    form.setValue("dateEnded", v ? datetime(v) : "");
                  }}
                  scheduleStartDate={form.watch("dateStarted")}
                  disableBefore={form.watch("dateStarted") || undefined}
                />
              </div>
            )}
          </div>
        )}
        {!!datasource && !isBandit && !isHoldout && (
          <>
            <Tooltip
              shouldDisplay={
                isExperimentIncludedInIncrementalRefresh &&
                form.watch("activationMetric") === ""
              }
              body="Activation Metrics are not yet supported with Incremental Refresh. Contact support if needed."
            >
              <MetricSelector
                disabled={isExperimentIncludedInIncrementalRefresh}
                datasource={form.watch("datasource")}
                exposureQueryId={exposureQueryId}
                project={experiment.project}
                includeFacts={true}
                labelClassName="font-weight-bold"
                label={
                  <>
                    Activation Metric
                    {!isExperimentIncludedInIncrementalRefresh ? (
                      <>
                        {" "}
                        <MetricsSelectorTooltip onlyBinomial={true} />
                      </>
                    ) : null}
                  </>
                }
                initialOption="None"
                onlyBinomial
                value={form.watch("activationMetric")}
                onChange={(value) =>
                  form.setValue("activationMetric", value || "")
                }
                helpText="Users must convert on this metric before being included"
              />
            </Tooltip>
            {isExperimentIncludedInIncrementalRefresh &&
              form.watch("activationMetric") !== "" && (
                <Callout status="warning" mb="2">
                  Activation metrics are not yet supported with Incremental
                  Refresh. Please{" "}
                  <Link
                    style={{ display: "inline" }}
                    onClick={() => form.setValue("activationMetric", "")}
                  >
                    click to remove it
                  </Link>
                  .
                </Callout>
              )}
          </>
        )}
        <StatsEngineSelect
          label={
            isBandit ? (
              <>
                <div>Statistics Engine</div>
                <div className="small text-muted">
                  Only <strong>Bayesian</strong> is available for Bandit
                  Experiments.
                </div>
              </>
            ) : undefined
          }
          value={form.watch("statsEngine")}
          onChange={(v) => {
            form.setValue("statsEngine", v);
          }}
          parentSettings={parentScopedSettings}
          allowUndefined={!isBandit}
          disabled={isBandit}
        />
        {!isHoldout && (
          <>
            <SelectField
              label={
                <PremiumTooltip commercialFeature="regression-adjustment">
                  <GBCuped /> Use CUPED
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
                  label: "On",
                  value: "on",
                },
                {
                  label: "Off",
                  value: "off",
                },
              ]}
              disabled={
                !hasRegressionAdjustmentFeature ||
                (isBandit && experiment.status !== "draft")
              }
            />
            {!orgSettings.disablePrecomputedDimensions ? (
              <SelectField
                label={
                  <PremiumTooltip commercialFeature="post-stratification">
                    Use Post-Stratification
                  </PremiumTooltip>
                }
                style={{ width: 200 }}
                labelClassName="font-weight-bold"
                value={
                  form.watch("postStratificationEnabled") === undefined
                    ? ""
                    : form.watch("postStratificationEnabled")
                      ? "on"
                      : "off"
                }
                onChange={(v) => {
                  form.setValue(
                    "postStratificationEnabled",
                    v === "" ? undefined : v === "on",
                  );
                }}
                options={[
                  {
                    label: "Organization default",
                    value: "",
                  },
                  {
                    label: "On",
                    value: "on",
                  },
                  {
                    label: "Off",
                    value: "off",
                  },
                ]}
                formatOptionLabel={({ value, label }) => {
                  if (value === "") {
                    return <em className="text-muted">{label}</em>;
                  }
                  return label;
                }}
                sort={false}
                helpText={
                  <span>
                    (
                    {parentScopedSettings.postStratificationEnabled.meta
                      ?.scopeApplied &&
                      parentScopedSettings.postStratificationEnabled.meta
                        ?.scopeApplied + " "}
                    default:{" "}
                    {parentScopedSettings.postStratificationEnabled.value
                      ? "On"
                      : "Off"}
                    )
                  </span>
                }
                disabled={
                  !hasPostStratificationFeature ||
                  (isBandit && experiment.status !== "draft")
                }
              />
            ) : null}
          </>
        )}
        {(form.watch("statsEngine") || scopedSettings.statsEngine.value) ===
          "frequentist" &&
          !isBandit &&
          !isHoldout && (
            <div className="d-flex flex-row no-gutters align-items-top">
              <div className="col-5">
                <SelectField
                  label={
                    <PremiumTooltip commercialFeature="sequential-testing">
                      <GBSequential /> Use Sequential Testing
                    </PremiumTooltip>
                  }
                  labelClassName="font-weight-bold"
                  value={form.watch("sequentialTestingEnabled") ? "on" : "off"}
                  onChange={(v) => {
                    form.setValue("sequentialTestingEnabled", v === "on");
                  }}
                  options={[
                    {
                      label: "On",
                      value: "on",
                    },
                    {
                      label: "Off",
                      value: "off",
                    },
                  ]}
                  helpText="Only applicable to frequentist analyses"
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
                  label="Tuning parameter"
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
                        is default)
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
                  Reset to Organization Default
                </label>
              </div>
            </div>
          )}
        {editMetrics && (
          <>
            <ExperimentMetricsSelector
              noLegacyMetrics={isExperimentIncludedInIncrementalRefresh}
              excludeQuantiles={isExperimentIncludedInIncrementalRefresh}
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
              setGuardrailMetrics={
                !isHoldout
                  ? (guardrailMetrics) =>
                      form.setValue("guardrailMetrics", guardrailMetrics)
                  : undefined
              }
              forceSingleGoalMetric={isBandit}
              noQuantileGoalMetrics={isBandit}
              filterConversionWindowMetrics={isHoldout}
              goalDisabled={isBandit && experiment.status !== "draft"}
              experimentId={experiment.id}
            />

            <CustomMetricSlicesSelector
              goalMetrics={form.watch("goalMetrics")}
              secondaryMetrics={form.watch("secondaryMetrics")}
              guardrailMetrics={form.watch("guardrailMetrics")}
              customMetricSlices={form.watch("customMetricSlices") || []}
              setCustomMetricSlices={(slices) =>
                form.setValue("customMetricSlices", slices)
              }
              pinnedMetricSlices={form.watch("pinnedMetricSlices") || []}
              setPinnedMetricSlices={(slices) =>
                form.setValue("pinnedMetricSlices", slices)
              }
            />

            {hasAdvancedSettings && (
              <>
                <hr className="mt-4" />

                <Collapsible
                  trigger={
                    <div className="link-purple font-weight-bold mt-4 mb-2">
                      <PiCaretRightFill className="chevron mr-1" />
                      Advanced Settings
                    </div>
                  }
                  transitionTime={100}
                >
                  <div className="rounded px-3 pt-3 pb-1 bg-highlight">
                    {datasourceProperties?.experimentSegments && (
                      <div className="form-group mb-2">
                        <SelectField
                          label="Segment"
                          labelClassName="font-weight-bold"
                          value={form.watch("segment")}
                          onChange={(value) =>
                            form.setValue("segment", value || "")
                          }
                          initialOption="None (All Users)"
                          options={filteredSegments.map((s) => {
                            return {
                              label: s.name,
                              value: s.id,
                            };
                          })}
                          helpText="Only users in this segment will be included"
                        />
                      </div>
                    )}
                    {datasourceProperties?.separateExperimentResultQueries && (
                      <div className="form-group mb-2">
                        <Tooltip
                          shouldDisplay={
                            isExperimentIncludedInIncrementalRefresh
                          }
                          body="In-progress Conversions is not supported with Incremental Refresh while in beta"
                        >
                          <SelectField
                            label="Metric Conversion Windows"
                            labelClassName="font-weight-bold"
                            value={form.watch("skipPartialData")}
                            onChange={(value) =>
                              form.setValue("skipPartialData", value)
                            }
                            options={[
                              {
                                label: "Include In-Progress Conversions",
                                value: "loose",
                              },
                              {
                                label: "Exclude In-Progress Conversions",
                                value: "strict",
                              },
                            ]}
                            isOptionDisabled={(option) =>
                              isExperimentIncludedInIncrementalRefresh &&
                              "value" in option &&
                              option.value === "strict"
                            }
                            helpText="How to treat users not enrolled in the experiment long enough to complete conversion window."
                          />
                        </Tooltip>
                      </div>
                    )}
                    {datasourceProperties?.separateExperimentResultQueries && (
                      <div className="form-group mb-2">
                        <SelectField
                          label={
                            <AttributionModelTooltip>
                              <strong>Conversion Window Override</strong>{" "}
                              <FaQuestionCircle />
                            </AttributionModelTooltip>
                          }
                          value={form.watch("attributionModel")}
                          onChange={(value) => {
                            const model = value as AttributionModel;
                            form.setValue("attributionModel", model);
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
                    )}
                    {datasourceProperties?.queryLanguage === "sql" && (
                      <div className="form-group mb-2">
                        <div className="row">
                          <div className="col">
                            <Field
                              label="Custom SQL Filter"
                              labelClassName="font-weight-bold"
                              {...form.register("queryFilter")}
                              textarea
                              placeholder="e.g. user_id NOT IN ('123', '456')"
                              helpText="WHERE clause to add to the default experiment query"
                            />
                          </div>
                          <div className="pt-2 border-left col-sm-4 col-lg-6">
                            Available columns:
                            <div className="mb-2 d-flex flex-wrap">
                              {["timestamp", "variation_id"]
                                .concat(
                                  exposureQuery
                                    ? [exposureQuery.userIdType]
                                    : [],
                                )
                                .concat(exposureQuery?.dimensions || [])
                                .map((d) => {
                                  return (
                                    <div
                                      className="mr-2 mb-2 border px-1"
                                      key={d}
                                    >
                                      <code>{d}</code>
                                    </div>
                                  );
                                })}
                            </div>
                            <div>
                              <strong>Tip:</strong> Use a subquery inside an{" "}
                              <code>IN</code> or <code>NOT IN</code> clause for
                              more advanced filtering.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {hasMetrics && (
                      <div className="form-group mb-2">
                        <PremiumTooltip commercialFeature="override-metrics">
                          <label className="font-weight-bold mb-1">
                            Metric Overrides
                          </label>
                        </PremiumTooltip>
                        <small className="form-text text-muted mb-2">
                          Override metric behaviors within this experiment.
                          Leave any fields empty that you do not want to
                          override.
                        </small>
                        <MetricsOverridesSelector
                          experiment={experiment}
                          form={
                            form as unknown as UseFormReturn<EditMetricsFormInterface>
                          }
                          disabled={
                            !hasOverrideMetricsFeature ||
                            isExperimentIncludedInIncrementalRefresh
                          }
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
                  </div>
                </Collapsible>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default AnalysisForm;
