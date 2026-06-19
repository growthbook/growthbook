import React, { FC, useCallback, useMemo, useState } from "react";
import {
  UseFormReturn,
  useFieldArray,
  useForm,
  FormProvider,
} from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  PiArrowSquareOutFill,
  PiCaretRightFill,
  PiCaretDownFill,
  PiPencilSimpleLine,
} from "react-icons/pi";
import { datetime, getValidDate } from "shared/dates";
import {
  DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  MAX_PRECOMPUTED_UNIT_DIMENSIONS,
} from "shared/constants";
import { isProjectListValidForProject } from "shared/util";
import { getScopedSettings } from "shared/settings";
import Collapsible from "react-collapsible";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, Popover, Separator } from "@radix-ui/themes";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import { type DecisionCriteriaData } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import useApi from "@/hooks/useApi";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import DatePicker from "@/components/DatePicker";
import {
  datasourceHasWritableEphemeralPipeline,
  getIsExperimentIncludedInIncrementalRefresh,
} from "@/services/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import MetricAnalysisWindowSelector from "./MetricAnalysisWindowSelector";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import { MetricsSelectorTooltip } from "./MetricsSelector";
import CustomMetricSlicesSelector from "./CustomMetricSlicesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";
import BanditDecisionMetricSettings from "./BanditDecisionMetricSettings";
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
    dimensions,
  } = useDefinitions();

  const { organization, hasCommercialFeature } = useUser();

  const permissionsUtil = usePermissionsUtil();

  const orgSettings = useOrgSettings();

  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [showDcDetailsModal, setShowDcDetailsModal] = useState(false);

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

  const defaultDatasource = experiment.datasource || "";
  const defaultDatasourceObj = getDatasourceById(defaultDatasource);
  const defaultExposureQueryId =
    getExposureQuery(
      defaultDatasourceObj?.settings,
      experiment.exposureQueryId,
      experiment.userIdType,
    )?.id || "";

  const form = useForm({
    defaultValues: {
      trackingKey: experiment.trackingKey || "",
      datasource: defaultDatasource,
      exposureQueryId: defaultExposureQueryId,
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
      variations: getLatestPhaseVariations(experiment) || [],
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
      precomputedUnitDimensionIds: experiment.precomputedUnitDimensionIds || [],
      metricOverrides: getDefaultMetricOverridesFormValue(
        experiment.metricOverrides || [],
        getExperimentMetricById,
        orgSettings,
      ),
      lookbackOverride: experiment.lookbackOverride
        ? experiment.lookbackOverride.type === "date"
          ? {
              type: "date" as const,
              value: getValidDate(experiment.lookbackOverride.value),
            }
          : {
              ...experiment.lookbackOverride,
              valueUnit:
                experiment.lookbackOverride.valueUnit ??
                DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
            }
        : undefined,
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
      banditConversionWindowValue: experiment.banditConversionWindowValue as
        | number
        | undefined,
      banditConversionWindowUnit: (experiment.banditConversionWindowUnit ??
        "hours") as "hours" | "days",
      disableStickyBucketing: experiment.disableStickyBucketing ?? false,
      decisionCriteriaId:
        experiment.decisionFrameworkSettings?.decisionCriteriaId ||
        (organization?.settings?.defaultDecisionCriteriaId ??
          PRESET_DECISION_CRITERIA.id),
      autoRollbackMode:
        experiment.autoRollbackMode ??
        organization?.settings?.defaultAutoRollbackMode ??
        "off",
      rampProgressionMode:
        experiment.rampProgressionMode ??
        organization?.settings?.defaultRampProgressionMode ??
        "hold-for-health",
      shippingCriteriaMode:
        experiment.shippingCriteria?.mode ??
        organization?.settings?.defaultShippingCriteriaMode ??
        "off",
    },
  });

  // A migration normalizes sequentialTestingEnabled to a boolean for every
  // experiment, so we can't distinguish "explicitly set to org default" from
  // "never set" by looking at the field. Treat values matching the org default
  // as the Default selection — behaviorally equivalent and lets the dropdown
  // initialize correctly on freshly created experiments.
  const [usingSequentialTestingDefault, setUsingSequentialTestingDefault] =
    useState(
      (experiment.sequentialTestingEnabled ?? false) ===
        !!orgSettings.sequentialTestingEnabled &&
        (experiment.sequentialTestingTuningParameter ??
          orgSettings.sequentialTestingTuningParameter ??
          DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER) ===
          (orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER),
    );
  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(() => {
      if (experiment.type !== "multi-armed-bandit") return false;
      const hasOverride =
        experiment.banditConversionWindowValue != null &&
        experiment.banditConversionWindowUnit != null;
      return !hasOverride;
    });
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
      experiment.type,
    );

  const datasourceField = form.watch("datasource");
  const hasPipelineModeFeature = hasCommercialFeature("pipeline-mode");
  const precomputedUnitDimensionOptions = useMemo(
    () =>
      dimensions
        .filter(
          (d) =>
            d.datasource === datasourceField &&
            (!exposureQuery || d.userIdType === exposureQuery.userIdType),
        )
        .map((d) => ({ label: d.name, value: d.id })),
    [dimensions, datasourceField, exposureQuery],
  );
  const datasourceHasWritableEphemeralPipelineEnabled = useMemo(
    () =>
      datasourceHasWritableEphemeralPipeline(
        datasource,
        hasPipelineModeFeature,
      ),
    [datasource, hasPipelineModeFeature],
  );

  const hasDecisionFramework =
    !!organization?.settings?.decisionFrameworkEnabled &&
    hasCommercialFeature("decision-framework");
  const { data: dcData } = useApi<{ decisionCriteria: DecisionCriteriaData[] }>(
    hasDecisionFramework ? "/decision-criteria" : "/noop",
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
  const hasEligiblePrecomputedUnitDimensions =
    precomputedUnitDimensionOptions.length > 0 &&
    datasourceHasWritableEphemeralPipelineEnabled;
  const allDecisionCriteria: DecisionCriteriaData[] = [
    ...PRESET_DECISION_CRITERIAS,
    ...(dcData?.decisionCriteria ?? []),
  ];
  const orgDefaultCriteriaId =
    organization?.settings?.defaultDecisionCriteriaId ?? "";
  // Falls back to the system preset ("Clear Signals") when the org hasn't
  // explicitly picked a default, matching the backend resolution order in
  // resolveDecisionCriteria.
  const orgDefaultCriteria =
    allDecisionCriteria.find((c) => c.id === orgDefaultCriteriaId) ??
    PRESET_DECISION_CRITERIA;

  // Advanced Settings requires a datasource — every field inside depends on
  // datasource-derived context (segments, override metrics, decision criteria
  // resolution, etc.). Metric presence is not required: Decision Criteria can
  // be pre-selected before metrics are added.
  const hasAdvancedSettings = !isBandit && !isHoldout && !!datasource;
  const selectedPrecomputedUnitDimensionIds =
    form.watch("precomputedUnitDimensionIds") || [];
  const precomputedUnitDimensionLimitReached =
    selectedPrecomputedUnitDimensionIds.length >=
    MAX_PRECOMPUTED_UNIT_DIMENSIONS;
  const precomputedUnitDimensionOptionsWithTooltips =
    precomputedUnitDimensionOptions.map((option) => ({
      ...option,
      tooltip:
        precomputedUnitDimensionLimitReached &&
        !selectedPrecomputedUnitDimensionIds.includes(option.value)
          ? `You can select up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS} always-computed unit dimensions.`
          : undefined,
    }));

  const removeInvalidPrecomputedUnitDimensionIds = ({
    datasourceId,
    userIdType,
  }: {
    datasourceId: string;
    userIdType?: string;
  }) => {
    const selectedUnitDimensionIds =
      form.watch("precomputedUnitDimensionIds") || [];
    if (selectedUnitDimensionIds.length === 0) return;

    form.setValue(
      "precomputedUnitDimensionIds",
      selectedUnitDimensionIds.filter((id) => {
        const dimension = dimensions.find((d) => d.id === id);
        return (
          dimension?.datasource === datasourceId &&
          (!userIdType || dimension.userIdType === userIdType)
        );
      }),
    );
  };

  const handleDatasourceChange = (newDatasource: string) => {
    form.setValue("datasource", newDatasource);
    if (!newDatasource) return;

    const ds = getDatasourceById(newDatasource);
    if (!getExposureQuery(ds?.settings, form.watch("exposureQueryId"))) {
      form.setValue("exposureQueryId", "");
    }

    const segment = form.watch("segment");
    if (segment && getSegmentById(segment)?.datasource !== newDatasource) {
      form.setValue("segment", "");
    }

    const isValidMetric = (id: string) =>
      getExperimentMetricById(id)?.datasource === newDatasource;

    const activationMetric = form.watch("activationMetric");
    if (activationMetric && !isValidMetric(activationMetric)) {
      form.setValue("activationMetric", "");
    }

    form.setValue(
      "goalMetrics",
      form.watch("goalMetrics").filter(isValidMetric),
    );
    form.setValue(
      "secondaryMetrics",
      form.watch("secondaryMetrics").filter(isValidMetric),
    );
    form.setValue(
      "guardrailMetrics",
      form.watch("guardrailMetrics").filter(isValidMetric),
    );
    removeInvalidPrecomputedUnitDimensionIds({ datasourceId: newDatasource });
  };

  const filteredDatasources = datasources.filter(
    (ds) =>
      ds.id === experiment.datasource ||
      isProjectListValidForProject(ds.projects, experiment.project),
  );

  return (
    <ModalStandard
      trackingEventModalType="analysis-form"
      trackingEventModalSource={source}
      header={"Analysis Settings"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const {
          dateStarted,
          dateEnded,
          skipPartialData,
          decisionCriteriaId,
          shippingCriteriaMode,
          ...values
        } = value;

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
        // Include lookbackOverride; use undefined to clear when user selects "None"
        if (value.lookbackOverride !== undefined) {
          body.lookbackOverride = value.lookbackOverride;
        } else if (experiment.lookbackOverride !== undefined) {
          body.lookbackOverride = undefined;
        }
        if (hasDecisionFramework && decisionCriteriaId !== undefined) {
          body.decisionFrameworkSettings = {
            ...experiment.decisionFrameworkSettings,
            decisionCriteriaId: decisionCriteriaId || undefined,
          };
        }

        if (shippingCriteriaMode !== undefined) {
          body.shippingCriteria = {
            mode: shippingCriteriaMode,
            plannedVariationId: experiment.shippingCriteria?.plannedVariationId,
          };
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
          body.precomputedUnitDimensionIds = [];
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
          if (disableBanditConversionWindow) {
            body.banditConversionWindowValue = null;
            body.banditConversionWindowUnit = null;
          } else if (
            !body.banditConversionWindowValue ||
            !body.banditConversionWindowUnit
          ) {
            throw new Error(
              "Enter a conversion window override or disable the conversion window override",
            );
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
      <Box>
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

        <div className="rounded px-3 py-3 mb-3 bg-highlight">
          <Flex direction="column" gap="2">
            <Flex align="center" gap="1">
              <Text as="label" weight="medium" mb="0">
                Data source:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{
                      color: datasource
                        ? "var(--color-text-high)"
                        : "var(--color-text-disabled)",
                    }}
                  >
                    <Text mr="1">
                      {datasource?.name ??
                        (filteredDatasources.length === 0
                          ? "No data sources"
                          : "Select data source")}
                    </Text>
                    <PiCaretDownFill />
                  </Link>
                }
                menuPlacement="start"
                variant="soft"
                disabled={isBandit && experiment.status !== "draft"}
              >
                <DropdownMenuGroup>
                  {filteredDatasources.map((ds) => (
                    <DropdownMenuItem
                      key={ds.id}
                      onClick={() => handleDatasourceChange(ds.id)}
                    >
                      {ds.name}
                      {ds.id === orgSettings?.defaultDataSource
                        ? " (default)"
                        : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>

            {datasource?.properties?.exposureQueries && (
              <Flex align="center" gap="1">
                <Text as="label" weight="medium" mb="0">
                  Assignment table:
                </Text>
                <DropdownMenu
                  trigger={
                    <Link
                      type="button"
                      style={{
                        color: exposureQuery
                          ? "var(--color-text-high)"
                          : "var(--color-text-disabled)",
                      }}
                    >
                      <Text mr="1">
                        {exposureQuery?.name ??
                          (exposureQueries.length > 0 ? "Select" : "—")}
                      </Text>
                      <PiCaretDownFill />
                    </Link>
                  }
                  menuPlacement="start"
                  variant="soft"
                  disabled={isBandit && experiment.status !== "draft"}
                >
                  <DropdownMenuGroup>
                    {exposureQueries.map((q) => (
                      <DropdownMenuItem
                        key={q.id}
                        onClick={() => {
                          form.setValue("exposureQueryId", q.id);
                          if (q.userIdType) {
                            removeInvalidPrecomputedUnitDimensionIds({
                              datasourceId: form.watch("datasource"),
                              userIdType: q.userIdType,
                            });
                          }
                        }}
                      >
                        {q.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenu>
              </Flex>
            )}

            {!isHoldout && (
              <Flex align="center" gap="1">
                <Text as="label" weight="medium" mb="0">
                  Tracking key:
                </Text>
                <Popover.Root>
                  <Popover.Trigger>
                    <Link
                      type="button"
                      style={{ color: "var(--color-text-high)" }}
                    >
                      <Text mr="1">{form.watch("trackingKey") || "—"}</Text>
                      <PiPencilSimpleLine />
                    </Link>
                  </Popover.Trigger>
                  <Popover.Content style={{ width: 340 }}>
                    <Field
                      label="Tracking Key"
                      {...form.register("trackingKey")}
                      helpText={
                        <>
                          Unique identifier for this experiment. Matches against
                          the <code>experiment_id</code> column in your data
                          source.
                        </>
                      }
                      disabled={
                        !canRunExperiment ||
                        (isBandit && experiment.status !== "draft")
                      }
                    />
                  </Popover.Content>
                </Popover.Root>
              </Flex>
            )}
          </Flex>

          {datasource &&
            (() => {
              const dsChanged =
                form.watch("datasource") !== (experiment.datasource || "");
              const eqChanged =
                form.watch("exposureQueryId") !==
                (experiment.exposureQueryId || "");
              const hasRun = experiment.status !== "draft";

              if (hasRun && (dsChanged || eqChanged)) {
                return (
                  <Callout status="warning" mt="2" size="sm">
                    You have changed the{" "}
                    {dsChanged && eqChanged
                      ? "data source and assignment table"
                      : dsChanged
                        ? "data source"
                        : "assignment table"}{" "}
                    on a {experiment.status} experiment. This will invalidate
                    existing results and require a full re-analysis.
                  </Callout>
                );
              }
              return (
                <HelperText status="info" mt="2" size="sm">
                  Changing the data source will remove incompatible metrics and
                  segments.
                </HelperText>
              );
            })()}
        </div>
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
                label="Analysis Start (UTC)"
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
                  label="Analysis End (UTC)"
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
        <StatsEngineSelect
          value={form.watch("statsEngine")}
          onChange={(v) => {
            form.setValue("statsEngine", v);
          }}
          parentSettings={parentScopedSettings}
          allowUndefined={!isBandit}
          disabled={isBandit}
          className=""
        />
        {!isHoldout && (
          <>
            <SelectField
              label={
                <PremiumTooltip commercialFeature="regression-adjustment">
                  CUPED
                </PremiumTooltip>
              }
              value={
                hasRegressionAdjustmentFeature &&
                form.watch("regressionAdjustmentEnabled")
                  ? "on"
                  : "off"
              }
              onChange={(v) => {
                form.setValue("regressionAdjustmentEnabled", v === "on");
              }}
              options={[
                { label: "On", value: "on" },
                { label: "Off", value: "off" },
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
                    Post-Stratification
                  </PremiumTooltip>
                }
                value={
                  !hasPostStratificationFeature ||
                  form.watch("postStratificationEnabled") == null
                    ? ""
                    : form.watch("postStratificationEnabled")
                      ? "on"
                      : "off"
                }
                onChange={(v) => {
                  form.setValue(
                    "postStratificationEnabled",
                    v === "" ? null : v === "on",
                  );
                }}
                options={[
                  {
                    label: `Default (${
                      hasPostStratificationFeature &&
                      parentScopedSettings.postStratificationEnabled.value
                        ? "On"
                        : "Off"
                    })`,
                    value: "",
                  },
                  { label: "On", value: "on" },
                  { label: "Off", value: "off" },
                ]}
                formatOptionLabel={({ value, label }) => {
                  if (value === "") {
                    return <em className="text-muted">{label}</em>;
                  }
                  return label;
                }}
                sort={false}
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
            <>
              <SelectField
                label={
                  <PremiumTooltip commercialFeature="sequential-testing">
                    Sequential Testing
                  </PremiumTooltip>
                }
                value={
                  usingSequentialTestingDefault
                    ? ""
                    : form.watch("sequentialTestingEnabled")
                      ? "on"
                      : "off"
                }
                onChange={(v) => {
                  if (v === "") {
                    setSequentialTestingToDefault(true);
                  } else {
                    setSequentialTestingToDefault(false);
                    form.setValue("sequentialTestingEnabled", v === "on");
                  }
                }}
                options={[
                  {
                    label: `Default (${
                      orgSettings.sequentialTestingEnabled ? "On" : "Off"
                    })`,
                    value: "",
                  },
                  { label: "On", value: "on" },
                  { label: "Off", value: "off" },
                ]}
                formatOptionLabel={({ value, label }) => {
                  if (value === "") {
                    return <em className="text-muted">{label}</em>;
                  }
                  return label;
                }}
                sort={false}
                disabled={!hasSequentialTestingFeature}
              />
              {((usingSequentialTestingDefault &&
                !!orgSettings.sequentialTestingEnabled) ||
                (!usingSequentialTestingDefault &&
                  form.watch("sequentialTestingEnabled"))) && (
                <Field
                  label="Tuning parameter"
                  type="number"
                  containerClassName="mb-0"
                  min="0"
                  readOnly={usingSequentialTestingDefault}
                  disabled={!hasSequentialTestingFeature || hasFileConfig()}
                  {...form.register("sequentialTestingTuningParameter", {
                    valueAsNumber: true,
                    validate: (v) => {
                      return !((v ?? 0) <= 0);
                    },
                  })}
                />
              )}
            </>
          )}

        <hr className="mt-2" />

        {editMetrics && (
          <>
            {isBandit && (
              <>
                <FormProvider {...form}>
                  <BanditDecisionMetricSettings
                    disableBanditConversionWindow={
                      disableBanditConversionWindow
                    }
                    setDisableBanditConversionWindow={
                      setDisableBanditConversionWindow
                    }
                    project={experiment.project}
                  />
                </FormProvider>
                {experiment.status !== "draft" && <Separator my="5" size="4" />}
              </>
            )}
            {!datasource ? (
              <Callout status="info" mt="2">
                Select a data source above to configure metrics.
              </Callout>
            ) : (
              <ExperimentMetricsSelector
                noLegacyMetrics={isExperimentIncludedInIncrementalRefresh}
                datasource={form.watch("datasource")}
                exposureQueryId={exposureQueryId}
                project={experiment.project}
                goalMetrics={form.watch("goalMetrics")}
                secondaryMetrics={form.watch("secondaryMetrics")}
                guardrailMetrics={form.watch("guardrailMetrics")}
                setGoalMetrics={
                  !isBandit
                    ? (goalMetrics) => form.setValue("goalMetrics", goalMetrics)
                    : undefined
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
                experimentType={experiment.type}
              />
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
                    label={
                      <>
                        Activation Metric
                        {!isExperimentIncludedInIncrementalRefresh ? (
                          <>
                            {" "}
                            <MetricsSelectorTooltip
                              onlyBinomial={true}
                              isSingular={true}
                            />
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

            <CustomMetricSlicesSelector
              className="mt-4 pt-4 border-top"
              goalMetrics={form.watch("goalMetrics")}
              secondaryMetrics={form.watch("secondaryMetrics")}
              guardrailMetrics={form.watch("guardrailMetrics")}
              customMetricSlices={form.watch("customMetricSlices") || []}
              setCustomMetricSlices={(slices) =>
                form.setValue("customMetricSlices", slices)
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
                  lazyRender={true}
                >
                  <div className="rounded px-3 pt-3 pb-1 bg-highlight">
                    <Flex align="center" gap="2" mb="3">
                      <Text weight="semibold" size="large">
                        Experiment Decision Framework
                      </Text>
                      <PaidFeatureBadge commercialFeature="decision-framework" />
                    </Flex>
                    <div className="form-group mb-4">
                      <Text weight="semibold" as="div" mb="1">
                        Decision Criteria
                      </Text>
                      <Text as="div" size="small" color="text-mid" mb="2">
                        Rules for deciding when to ship, rollback, or review.
                      </Text>
                      {hasDecisionFramework ? (
                        <>
                          {showDcDetailsModal && (
                            <DecisionCriteriaModal
                              decisionCriteria={
                                allDecisionCriteria.find(
                                  (c) =>
                                    c.id === form.watch("decisionCriteriaId"),
                                ) ?? orgDefaultCriteria
                              }
                              editable={false}
                              onClose={() => setShowDcDetailsModal(false)}
                              mutate={() => {}}
                            />
                          )}
                          <Flex gap="2" align="end">
                            <Box style={{ flex: 1 }}>
                              <SelectField
                                value={form.watch("decisionCriteriaId")}
                                onChange={(v) => {
                                  form.setValue("decisionCriteriaId", v);
                                }}
                                options={allDecisionCriteria.map((c) => ({
                                  value: c.id,
                                  label: c.name,
                                }))}
                                formatOptionLabel={({ value, label }) => (
                                  <span
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      width: "100%",
                                    }}
                                  >
                                    {label}
                                    {value === orgDefaultCriteriaId && (
                                      <span
                                        className="text-muted uppercase-title"
                                        style={{ marginLeft: "auto" }}
                                      >
                                        default
                                      </span>
                                    )}
                                  </span>
                                )}
                                sort={false}
                              />
                            </Box>
                            <Button
                              variant="outline"
                              color="gray"
                              onClick={() => setShowDcDetailsModal(true)}
                              mb="1"
                            >
                              View
                            </Button>
                          </Flex>
                        </>
                      ) : (
                        <Text as="div" size="small" color="text-low">
                          Not enabled for this organization.{" "}
                          <Link
                            href="/settings?tab=experiment"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Enable in Organization Settings
                            <PiArrowSquareOutFill className="ml-1" />
                          </Link>
                        </Text>
                      )}
                    </div>
                    <div className="form-group mb-4">
                      <Text weight="semibold" as="div" mb="3">
                        Automation
                      </Text>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "180px 1fr",
                          gap: "8px 16px",
                          alignItems: "center",
                        }}
                      >
                        <Text as="div" weight="medium">
                          Shipping
                        </Text>
                        <SelectField
                          value={
                            (form.watch(
                              "shippingCriteriaMode" as never,
                            ) as unknown as string) ?? "off"
                          }
                          onChange={(v) => {
                            form.setValue(
                              "shippingCriteriaMode" as never,
                              v as never,
                            );
                          }}
                          options={[
                            { value: "off", label: "Manual" },
                            {
                              value: "auto",
                              label: "Auto-ship on end date if clear winner",
                            },
                            {
                              value: "auto-force",
                              label: "Auto-ship on end date regardless",
                            },
                          ]}
                          isOptionDisabled={(o) =>
                            !hasDecisionFramework &&
                            "value" in o &&
                            (o.value === "auto" || o.value === "auto-force")
                          }
                          formatOptionLabel={({ value, label }) => (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                width: "100%",
                              }}
                            >
                              {label}
                              {value ===
                                (organization?.settings
                                  ?.defaultShippingCriteriaMode ?? "off") && (
                                <span
                                  className="text-muted uppercase-title"
                                  style={{ marginLeft: "auto" }}
                                >
                                  default
                                </span>
                              )}
                            </span>
                          )}
                          sort={false}
                          isSearchable={false}
                        />
                        <Text as="div" weight="medium">
                          Rollbacks
                        </Text>
                        <SelectField
                          value={
                            (form.watch(
                              "autoRollbackMode" as never,
                            ) as unknown as string) ?? "off"
                          }
                          onChange={(v) => {
                            form.setValue(
                              "autoRollbackMode" as never,
                              v as never,
                            );
                          }}
                          options={[
                            { value: "off", label: "Manual" },
                            { value: "all", label: "Automatic" },
                            {
                              value: "health-only",
                              label: "Automatic for health signals only",
                            },
                          ]}
                          formatOptionLabel={({ value, label }) => (
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                width: "100%",
                              }}
                            >
                              {label}
                              {value ===
                                (organization?.settings
                                  ?.defaultAutoRollbackMode ?? "off") && (
                                <span
                                  className="text-muted uppercase-title"
                                  style={{ marginLeft: "auto" }}
                                >
                                  default
                                </span>
                              )}
                            </span>
                          )}
                          sort={false}
                          isSearchable={false}
                        />
                        {!!experiment.rampScheduleId && (
                          <>
                            <Text as="div" weight="medium">
                              Ramp schedules
                            </Text>
                            <SelectField
                              value={
                                (form.watch(
                                  "rampProgressionMode" as never,
                                ) as unknown as string) ?? "hold-for-health"
                              }
                              onChange={(v) => {
                                form.setValue(
                                  "rampProgressionMode" as never,
                                  v as never,
                                );
                              }}
                              options={[
                                {
                                  value: "hold-for-health",
                                  label: "Hold for health signals",
                                },
                                {
                                  value: "ignore",
                                  label: "Ignore signals",
                                },
                              ]}
                              formatOptionLabel={({ value, label }) => (
                                <span
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    width: "100%",
                                  }}
                                >
                                  {label}
                                  {value ===
                                    (organization?.settings
                                      ?.defaultRampProgressionMode ??
                                      "hold-for-health") && (
                                    <span
                                      className="text-muted uppercase-title"
                                      style={{ marginLeft: "auto" }}
                                    >
                                      default
                                    </span>
                                  )}
                                </span>
                              )}
                              sort={false}
                              isSearchable={false}
                            />
                          </>
                        )}
                      </div>
                    </div>
                    {hasEligiblePrecomputedUnitDimensions && (
                      <div className="form-group mb-2">
                        <MultiSelectField
                          label="Always-computed unit dimensions"
                          labelClassName="font-weight-bold"
                          helpText={`These dimensions will be computed automatically on every refresh, similar to precomputed dimensions. You can select up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS}. Changes apply on the next refresh.`}
                          value={selectedPrecomputedUnitDimensionIds}
                          options={precomputedUnitDimensionOptionsWithTooltips}
                          isOptionDisabled={(option) => {
                            if (!("value" in option)) return false;
                            return (
                              precomputedUnitDimensionLimitReached &&
                              !selectedPrecomputedUnitDimensionIds.includes(
                                option.value,
                              )
                            );
                          }}
                          onChange={(v) =>
                            form.setValue(
                              "precomputedUnitDimensionIds",
                              v.slice(0, MAX_PRECOMPUTED_UNIT_DIMENSIONS),
                            )
                          }
                        />
                      </div>
                    )}
                    {datasourceProperties?.experimentSegments &&
                      filteredSegments.length > 0 && (
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
                        <MetricAnalysisWindowSelector
                          attributionModel={
                            form.watch("attributionModel") ||
                            orgSettings.attributionModel ||
                            "firstExposure"
                          }
                          lookbackOverride={form.watch("lookbackOverride")}
                          onAttributionModelChange={(v) =>
                            form.setValue("attributionModel", v)
                          }
                          onLookbackOverrideChange={(v) =>
                            form.setValue("lookbackOverride", v)
                          }
                          phaseEndDate={
                            experiment.status === "stopped" && phaseObj
                              ? getValidDate(phaseObj.dateEnded ?? "")
                              : new Date()
                          }
                          disabled={isExperimentIncludedInIncrementalRefresh}
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
                      <>
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
                          />
                          {!hasOverrideMetricsFeature && (
                            <UpgradeMessage
                              showUpgradeModal={() => setUpgradeModal(true)}
                              commercialFeature="override-metrics"
                              upgradeMessage="override metrics"
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Collapsible>
              </>
            )}
          </>
        )}
      </Box>
    </ModalStandard>
  );
};

export default AnalysisForm;
