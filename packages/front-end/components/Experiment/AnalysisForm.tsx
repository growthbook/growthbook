import React, { FC, useCallback, useMemo, useState } from "react";
import {
  UseFormReturn,
  useFieldArray,
  useForm,
  FormProvider,
} from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
  MAX_PRECOMPUTED_UNIT_DIMENSIONS,
} from "shared/constants";
import {
  resolveAnalysisIdentifierType,
  isProjectListValidForProject,
} from "shared/util";
import { getScopedSettings, getUnsetAnalysisSettings } from "shared/settings";
import { getLatestPhaseVariations } from "shared/experiments";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getDefaultIdentifierType,
  getExposureQueriesInScope,
  getExposureQuery,
  getHashAttributeIdentifierTypeMap,
  getSelectableIdentifierTypes,
} from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import AssignmentQueryFields, {
  AssignmentQueryDriftWarning,
  useAssignmentQuerySelection,
} from "@/components/Experiment/AssignmentQueryFields";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import HelperText from "@/ui/HelperText";
import DatePicker from "@/components/DatePicker";
import {
  datasourceHasWritableEphemeralPipeline,
  getIsExperimentIncludedInIncrementalRefresh,
} from "@/services/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import MetricAnalysisWindowSelector from "./MetricAnalysisWindowSelector";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import CustomMetricSlicesSelector from "./CustomMetricSlicesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";
import ActivationMetricRow from "./ActivationMetricRow";
import { DATASOURCE_CHANGE_NOTE } from "./TabbedPage/AnalysisPlan";
import {
  AdvancedSection,
  ConversionWindowsRow,
  QueryFilterHelp,
  SettingsCard,
} from "./TabbedPage/AnalysisPlanAdvanced";
import SetupFieldRow, { SetupFieldGroup } from "./TabbedPage/SetupFieldRow";
import { QuickEditRow } from "./TabbedPage/QuickEditButton";
import BanditDecisionMetricSettings from "./BanditDecisionMetricSettings";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";

export type AnalysisFormFocus = "datasource" | "exposureQuery" | "goalMetrics";

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
  /**
   * A holdout's assignment query must cover every Project the holdout spans.
   */
  holdoutProjects?: string[];
  /** Opens with this field focused. */
  focus?: AnalysisFormFocus | null;
}> = ({
  experiment,
  envs,
  cancel,
  mutate,
  phase,
  source,
  holdoutProjects,
  editVariationIds = true,
  editDates = true,
  editMetrics = false,
  focus = null,
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingDataSource, setEditingDataSource] = useState(
    !experiment.datasource || !experiment.exposureQueryId,
  );

  const pid = experiment?.project;
  const project = pid ? getProjectById(pid) : null;

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment,
  });

  // What the experiment leaves unset starts at what saving it will store.
  const settled = {
    ...experiment,
    ...getUnsetAnalysisSettings({
      organization,
      project: project ?? undefined,
      experiment,
    }),
  };

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
  const initialDatasource = getDatasourceById(experiment.datasource);
  const initialDatasourceSettings = initialDatasource?.settings;
  const initialExposureQuery = getExposureQuery(
    initialDatasourceSettings,
    experiment.exposureQueryId,
    experiment.userIdType,
  );
  /**
   * Show what the experiment analyzes on, even a drifted identifier, so the
   * form can flag it; with no query yet, pre-fill from the hash attribute.
   */
  const initialIdentifierType = initialExposureQuery
    ? resolveAnalysisIdentifierType(
        initialExposureQuery,
        experiment.exposureQueryIdentifierType,
      )
    : getDefaultIdentifierType({
        identifierTypes: getSelectableIdentifierTypes(
          initialDatasource
            ? getExposureQueriesInScope(
                initialDatasource,
                experiment.project,
                holdoutProjects,
              )
            : [],
        ),
        hashAttributeIdentifierTypeMap: getHashAttributeIdentifierTypeMap(
          initialDatasourceSettings?.userIdTypes,
        ),
        hashAttribute: experiment.hashAttribute,
      });

  const form = useForm({
    defaultValues: {
      trackingKey: experiment.trackingKey || "",
      datasource: experiment.datasource || "",
      exposureQueryId: initialExposureQuery?.id || "",
      exposureQueryIdentifierType: initialIdentifierType,
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      skipPartialData: experiment.skipPartialData ? "strict" : "loose",
      attributionModel:
        experiment.attributionModel ||
        orgSettings.attributionModel ||
        "firstExposure",
      dateStarted: getValidDate(phaseObj?.dateStarted ?? "").toISOString(),
      dateEnded: getValidDate(phaseObj?.dateEnded ?? "").toISOString(),
      variations: getLatestPhaseVariations(experiment) || [],
      phases: experiment.phases || [],
      sequentialTestingEnabled:
        hasSequentialTestingFeature && !!settled.sequentialTestingEnabled,
      sequentialTestingTuningParameter:
        settled.sequentialTestingTuningParameter,
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
      statsEngine: settled.statsEngine,
      regressionAdjustmentEnabled: settled.regressionAdjustmentEnabled,
      postStratificationEnabled: settled.postStratificationEnabled,
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
    },
  });

  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(() => {
      if (experiment.type !== "multi-armed-bandit") return false;
      const hasOverride =
        experiment.banditConversionWindowValue != null &&
        experiment.banditConversionWindowUnit != null;
      return !hasOverride;
    });

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

  const exposureQueryId = form.watch("exposureQueryId");
  const exposureQueryIdentifierType = form.watch("exposureQueryIdentifierType");
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId,
  );

  const setExposureQueryId = useCallback(
    (value: string) => form.setValue("exposureQueryId", value),
    [form],
  );
  const setExposureQueryIdentifierType = useCallback(
    (identifierType: string | undefined) => {
      form.setValue("exposureQueryIdentifierType", identifierType);
      if (!identifierType) return;
      const selectedUnitDimensionIds =
        form.getValues("precomputedUnitDimensionIds") || [];
      if (!selectedUnitDimensionIds.length) return;
      const datasourceId = form.getValues("datasource");
      form.setValue(
        "precomputedUnitDimensionIds",
        selectedUnitDimensionIds.filter((id) => {
          const dimension = dimensions.find((d) => d.id === id);
          return (
            dimension?.datasource === datasourceId &&
            dimension.userIdType === identifierType
          );
        }),
      );
    },
    [form, dimensions],
  );
  const assignmentQuerySelection = useAssignmentQuerySelection({
    datasource,
    project: experiment.project,
    holdoutProjects,
    hashAttribute: experiment.hashAttribute,
    exposureQueryId,
    identifierType: exposureQueryIdentifierType,
    setExposureQueryId,
    setIdentifierType: setExposureQueryIdentifierType,
    autoRepair: false,
    keepCurrentSelection: true,
  });

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
            (!exposureQuery ||
              d.userIdType ===
                resolveAnalysisIdentifierType(
                  exposureQuery,
                  exposureQueryIdentifierType,
                )),
        )
        .map((d) => ({ label: d.name, value: d.id })),
    [dimensions, datasourceField, exposureQuery, exposureQueryIdentifierType],
  );
  const datasourceHasWritableEphemeralPipelineEnabled = useMemo(
    () =>
      datasourceHasWritableEphemeralPipeline(
        datasource,
        hasPipelineModeFeature,
      ),
    [datasource, hasPipelineModeFeature],
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
  const hasAdvancedSettings = !isBandit && !isHoldout;
  const showSegments =
    !!datasourceProperties?.experimentSegments && filteredSegments.length > 0;
  const hasExposureSettings =
    showSegments || datasourceProperties?.queryLanguage === "sql";
  const hasMetricSettings =
    !!datasourceProperties?.separateExperimentResultQueries ||
    hasEligiblePrecomputedUnitDimensions ||
    hasMetrics;
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

  return (
    <ModalStandard
      trackingEventModalType="analysis-form"
      trackingEventModalSource={source}
      header={"Analysis Settings"}
      open={true}
      close={cancel}
      size="lg"
      submit={validatedSubmit(form, async (value) => {
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
        // Include lookbackOverride; use undefined to clear when user selects "None"
        if (value.lookbackOverride !== undefined) {
          body.lookbackOverride = value.lookbackOverride;
        } else if (experiment.lookbackOverride !== undefined) {
          body.lookbackOverride = undefined;
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

        {!editingDataSource ? (
          <SetupFieldGroup>
            <QuickEditRow
              label="Edit data settings"
              onEdit={!isBandit ? () => setEditingDataSource(true) : null}
            >
              <Box flexGrow="1">
                <SetupFieldRow label="Data Source" content="text">
                  <Text color="text-high">
                    {datasource?.name || <em>None</em>}
                  </Text>
                </SetupFieldRow>
                {datasource?.properties?.exposureQueries && (
                  <>
                    <SetupFieldRow label="Identifier type" content="text">
                      <Text color="text-high">
                        {exposureQueryIdentifierType || <em>Choose...</em>}
                      </Text>
                    </SetupFieldRow>
                    <SetupFieldRow label="Assignment query" content="text">
                      <Text color="text-high">
                        {exposureQuery?.name || <em>Choose...</em>}
                      </Text>
                      <AssignmentQueryDriftWarning
                        selection={assignmentQuerySelection}
                        as="helperText"
                      />
                    </SetupFieldRow>
                  </>
                )}
                {datasource && !isHoldout && (
                  <SetupFieldRow label="Experiment key" content="text">
                    <Text color="text-high">
                      {form.watch("trackingKey") || <em>None</em>}
                    </Text>
                  </SetupFieldRow>
                )}
              </Box>
            </QuickEditRow>
          </SetupFieldGroup>
        ) : (
          <>
            <SetupFieldRow label="Data Source">
              <SelectField
                value={datasource?.id || ""}
                autoFocus={focus === "datasource"}
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
                    !getExposureQuery(
                      ds?.settings,
                      form.watch("exposureQueryId"),
                    )
                  ) {
                    form.setValue("exposureQueryId", "");
                    form.setValue(
                      "exposureQueryIdentifierType",
                      getDefaultIdentifierType({
                        identifierTypes: getSelectableIdentifierTypes(
                          ds
                            ? getExposureQueriesInScope(
                                ds,
                                experiment.project,
                                holdoutProjects,
                              )
                            : [],
                        ),
                        hashAttributeIdentifierTypeMap:
                          getHashAttributeIdentifierTypeMap(
                            ds?.settings?.userIdTypes,
                          ),
                        hashAttribute: experiment.hashAttribute,
                      }),
                    );
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
                  form.setValue(
                    "guardrailMetrics",
                    guardrails.filter(isValidMetric),
                  );

                  removeInvalidPrecomputedUnitDimensionIds({
                    datasourceId: newDatasource,
                  });
                }}
                options={datasources
                  .filter(
                    (ds) =>
                      ds.id === experiment.datasource ||
                      isProjectListValidForProject(
                        ds.projects,
                        experiment.project,
                      ),
                  )
                  .map((d) => ({
                    value: d.id,
                    label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
                  }))}
                className="portal-overflow-ellipsis"
                helpText={
                  experiment.datasource ? DATASOURCE_CHANGE_NOTE : undefined
                }
              />
            </SetupFieldRow>
            {datasource?.properties?.exposureQueries && (
              <AssignmentQueryFields
                asRows
                selection={assignmentQuerySelection}
                placeholder="Choose..."
                autoFocus={focus === "exposureQuery"}
                disabled={isBandit && experiment.status !== "draft"}
              />
            )}
            {datasource && !isHoldout && (
              <SetupFieldRow label="Experiment key">
                <Field
                  {...form.register("trackingKey")}
                  helpText={
                    <>
                      Unique identifier for this experiment, used to track
                      impressions and analyze results. Will match against the{" "}
                      <code>experiment_id</code> column in your data source.
                    </>
                  }
                  disabled={
                    !canRunExperiment ||
                    (isBandit && experiment.status !== "draft")
                  }
                />
              </SetupFieldRow>
            )}
          </>
        )}
        {editVariationIds && (
          <SetupFieldRow
            label="Variation IDs"
            tooltip="Matched against the variation_id column in your Data Source."
          >
            <Flex gap="3" wrap="wrap">
              {variations.fields.map((v, i) => (
                <Box key={i} flexGrow="1" flexBasis="120px">
                  <Field
                    label={v.name}
                    labelClassName="mb-0"
                    containerClassName="mb-0"
                    {...form.register(`variations.${i}.key`)}
                    placeholder={i + ""}
                  />
                </Box>
              ))}
            </Flex>
          </SetupFieldRow>
        )}
        {!!phaseObj &&
          editDates &&
          !isBandit &&
          !isHoldout &&
          experiment.status !== "draft" && (
            <>
              <SetupFieldRow
                label="Start time"
                tooltip="Only include users who entered the experiment on or after this date."
              >
                <DatePicker
                  timeZone="utc"
                  date={form.watch("dateStarted")}
                  setDate={(v) => {
                    form.setValue("dateStarted", v ? v.toISOString() : "");
                  }}
                  scheduleEndDate={form.watch("dateEnded")}
                  disableAfter={form.watch("dateEnded") || undefined}
                />
              </SetupFieldRow>
              {experiment.status === "stopped" && (
                <SetupFieldRow
                  label="End time"
                  tooltip="Only include users who entered the experiment on or before this date."
                >
                  <DatePicker
                    timeZone="utc"
                    date={form.watch("dateEnded")}
                    setDate={(v) => {
                      form.setValue("dateEnded", v ? v.toISOString() : "");
                    }}
                    scheduleStartDate={form.watch("dateStarted")}
                    disableBefore={form.watch("dateStarted") || undefined}
                  />
                </SetupFieldRow>
              )}
            </>
          )}
        <SetupFieldRow label="Stats engine">
          <Box maxWidth="300px">
            <StatsEngineSelect
              label={null}
              labelClassName=""
              containerClassName="mb-0"
              className=""
              value={form.watch("statsEngine")}
              onChange={(v) => {
                form.setValue("statsEngine", v);
              }}
              allowUndefined={false}
              disabled={isBandit}
            />
          </Box>
        </SetupFieldRow>
        {!isHoldout && (
          <SetupFieldRow label="Variance reduction" content="text">
            <Flex direction="column" gap="2">
              <Checkbox
                label={
                  <PremiumTooltip commercialFeature="regression-adjustment">
                    CUPED
                  </PremiumTooltip>
                }
                weight="regular"
                value={
                  hasRegressionAdjustmentFeature &&
                  !!form.watch("regressionAdjustmentEnabled")
                }
                setValue={(v) =>
                  form.setValue("regressionAdjustmentEnabled", v)
                }
                disabled={
                  !hasRegressionAdjustmentFeature ||
                  (isBandit && experiment.status !== "draft")
                }
              />
              {!orgSettings.disablePrecomputedDimensions ? (
                <Checkbox
                  label={
                    <PremiumTooltip commercialFeature="post-stratification">
                      Post-stratification
                    </PremiumTooltip>
                  }
                  weight="regular"
                  value={
                    hasPostStratificationFeature &&
                    !!form.watch("postStratificationEnabled")
                  }
                  setValue={(v) =>
                    form.setValue("postStratificationEnabled", v)
                  }
                  disabled={
                    !hasPostStratificationFeature ||
                    (isBandit && experiment.status !== "draft")
                  }
                />
              ) : null}
            </Flex>
          </SetupFieldRow>
        )}
        {(form.watch("statsEngine") || scopedSettings.statsEngine.value) ===
          "frequentist" &&
          !isBandit &&
          !isHoldout && (
            <SetupFieldRow label="Corrections" content="text">
              <Flex direction="column" gap="2">
                <Checkbox
                  label={
                    <PremiumTooltip commercialFeature="sequential-testing">
                      Sequential testing
                    </PremiumTooltip>
                  }
                  weight="regular"
                  value={!!form.watch("sequentialTestingEnabled")}
                  setValue={(v) => form.setValue("sequentialTestingEnabled", v)}
                  disabled={!hasSequentialTestingFeature}
                />
                {form.watch("sequentialTestingEnabled") ? (
                  <Flex align="center" gap="3" pl="5">
                    <Text>Tuning parameter</Text>
                    <Box width="120px">
                      <Field
                        type="number"
                        containerClassName="mb-0"
                        min="0"
                        disabled={
                          !hasSequentialTestingFeature || hasFileConfig()
                        }
                        {...form.register("sequentialTestingTuningParameter", {
                          valueAsNumber: true,
                          validate: (v) => {
                            return !((v ?? 0) <= 0);
                          },
                        })}
                      />
                    </Box>
                  </Flex>
                ) : null}
              </Flex>
            </SetupFieldRow>
          )}

        <Separator size="4" my="4" />

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
            <ExperimentMetricsSelector
              asRows
              autoFocus={focus === "goalMetrics"}
              datasource={form.watch("datasource")}
              exposureQueryId={exposureQueryId}
              exposureQueryIdentifierType={exposureQueryIdentifierType}
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

            {!!datasource && !isBandit && !isHoldout && (
              <ActivationMetricRow
                datasource={form.watch("datasource")}
                exposureQueryId={exposureQueryId}
                exposureQueryIdentifierType={exposureQueryIdentifierType}
                project={experiment.project}
                value={form.watch("activationMetric")}
                onChange={(metric) => form.setValue("activationMetric", metric)}
                incrementalRefresh={isExperimentIncludedInIncrementalRefresh}
              />
            )}

            <CustomMetricSlicesSelector
              asRow
              goalMetrics={form.watch("goalMetrics")}
              secondaryMetrics={form.watch("secondaryMetrics")}
              guardrailMetrics={form.watch("guardrailMetrics")}
              customMetricSlices={form.watch("customMetricSlices") || []}
              setCustomMetricSlices={(slices) =>
                form.setValue("customMetricSlices", slices)
              }
            />

            {hasAdvancedSettings && (
              <Box>
                <Separator size="4" my="5" />
                <AdvancedSection open={advancedOpen} setOpen={setAdvancedOpen}>
                  {hasExposureSettings && (
                    <SettingsCard title="Exposures">
                      {showSegments && (
                        <SetupFieldRow
                          label="Segment"
                          tooltip="Only users in this segment will be included."
                        >
                          <SelectField
                            value={form.watch("segment")}
                            onChange={(value) =>
                              form.setValue("segment", value || "")
                            }
                            initialOption="None (all users)"
                            options={filteredSegments.map((s) => ({
                              label: s.name,
                              value: s.id,
                            }))}
                          />
                        </SetupFieldRow>
                      )}
                      {datasourceProperties?.queryLanguage === "sql" && (
                        <SetupFieldRow label="Custom SQL filter">
                          <Field
                            textarea
                            {...form.register("queryFilter")}
                            placeholder="e.g. user_id NOT IN ('123', '456')"
                            containerClassName="mb-0"
                          />
                          <QueryFilterHelp exposureQuery={exposureQuery} />
                        </SetupFieldRow>
                      )}
                    </SettingsCard>
                  )}
                  {hasMetricSettings && (
                    <SettingsCard title="Metrics">
                      {datasourceProperties?.separateExperimentResultQueries && (
                        <>
                          <ConversionWindowsRow
                            strict={form.watch("skipPartialData") === "strict"}
                            setStrict={(strict) =>
                              form.setValue(
                                "skipPartialData",
                                strict ? "strict" : "loose",
                              )
                            }
                            incrementalRefresh={
                              isExperimentIncludedInIncrementalRefresh
                            }
                          />
                          <SetupFieldRow
                            label="Metric windows"
                            tooltip="Apply custom metric window behavior in this experiment."
                          >
                            <MetricAnalysisWindowSelector
                              bare
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
                              disabled={
                                isExperimentIncludedInIncrementalRefresh
                              }
                            />
                          </SetupFieldRow>
                        </>
                      )}
                      {hasEligiblePrecomputedUnitDimensions && (
                        <SetupFieldRow
                          label="Unit dimensions"
                          tooltip={`Always computed on every refresh, like precomputed dimensions. Up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS}.`}
                        >
                          <MultiSelectField
                            value={selectedPrecomputedUnitDimensionIds}
                            options={
                              precomputedUnitDimensionOptionsWithTooltips
                            }
                            isOptionDisabled={(option) =>
                              "value" in option &&
                              precomputedUnitDimensionLimitReached &&
                              !selectedPrecomputedUnitDimensionIds.includes(
                                option.value,
                              )
                            }
                            onChange={(v) =>
                              form.setValue(
                                "precomputedUnitDimensionIds",
                                v.slice(0, MAX_PRECOMPUTED_UNIT_DIMENSIONS),
                              )
                            }
                          />
                        </SetupFieldRow>
                      )}
                      {hasMetrics && (
                        <SetupFieldRow
                          label="Metric overrides"
                          tooltip="Override metric behaviors within this experiment."
                          stacked
                        >
                          <MetricsOverridesSelector
                            experiment={experiment}
                            // The source being edited here, not the stored one.
                            datasource={form.watch("datasource")}
                            statsEngine={
                              form.watch("statsEngine") ||
                              scopedSettings.statsEngine.value
                            }
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
                        </SetupFieldRow>
                      )}
                    </SettingsCard>
                  )}
                </AdvancedSection>
              </Box>
            )}
          </>
        )}
      </Box>
    </ModalStandard>
  );
};

export default AnalysisForm;
