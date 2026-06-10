import React, { FC, useEffect, useState, useCallback, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
  Variation,
} from "shared/types/experiment";
import {
  ApiContextualBanditInterface,
  ApiCreateContextualBanditBody,
} from "shared/validators";
import { useRouter } from "next/router";
import { datetime, getValidDate } from "shared/dates";
import { validateAndFixCondition } from "shared/util";
import { getScopedSettings } from "shared/settings";
import { generateTrackingKey, getEqualWeights } from "shared/experiments";
import { kebabCase } from "lodash";
import { Box } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import {
  generateVariationId,
  useAttributeSchema,
  useEnvironments,
  validateUnregisteredAttributes,
} from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useUser } from "@/services/UserContext";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import useSDKConnections from "@/hooks/useSDKConnections";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import TagsInput from "@/components/Tags/TagsInput";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import { useExperiments } from "@/hooks/useExperiments";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import Checkbox from "@/ui/Checkbox";
import DatePicker from "@/components/DatePicker";
import {
  getDefaultVariations,
  getNewExperimentDatasourceDefaults,
} from "@/components/Experiment/NewExperimentForm";

export type ContextualBanditFormProps = {
  initialStep?: number;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialNumVariations?: number;
  duplicate?: boolean;
  source: string;
  onClose?: () => void;
  onCreate?: (id: string) => void;
  inline?: boolean;
  isNewExperiment?: boolean;
};

const ContextualBanditForm: FC<ContextualBanditFormProps> = ({
  initialStep = 0,
  initialValue = {},
  initialNumVariations = 2,
  onClose,
  onCreate = null,
  duplicate,
  source,
  inline,
  isNewExperiment,
}) => {
  const { organization, hasCommercialFeature } = useUser();

  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);
  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] =
    useState(false);
  const [useSameSeedAsOriginal, setUseSameSeedAsOriginal] = useState(false);

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
    projects,
    getExperimentMetricById,
  } = useDefinitions();
  const environments = useEnvironments();
  const { experiments } = useExperiments();

  const envs = environments.map((e) => e.id);

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const [disableBanditConversionWindow, setDisableBanditConversionWindow] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    experiment: (initialValue ?? undefined) as
      | ExperimentInterfaceStringDates
      | undefined,
  });
  const permissionsUtils = usePermissionsUtil();
  const { refreshWatching } = useWatching();

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project,
  );

  const [conditionKey, forceConditionRender] = useIncrementer();

  const allAttributesSchema = useAttributeSchema(false);
  const attributeSchema = useAttributeSchema(false, project);
  const hashAttributes =
    attributeSchema?.filter((a) => a.hashAttribute)?.map((a) => a.property) ||
    [];
  const hashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const lastPhase = (initialValue?.phases?.length ?? 1) - 1;
  const initialHashAttribute = initialValue?.hashAttribute || hashAttribute;

  const initialExpVariations =
    initialValue?.variations ?? getDefaultVariations(initialNumVariations);
  const toPhaseVariations = (vars: Variation[]) =>
    vars.map((v) => ({
      id: v.id,
      status: "active" as const,
    }));
  const toEqualWeights = (vars: Variation[]) => getEqualWeights(vars.length);

  // TODO(holdout-v1.5): wire up holdout configuration UI when back-end is ready.
  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialValue?.project || project || "",
      trackingKey: initialValue?.trackingKey || "",
      ...getNewExperimentDatasourceDefaults({
        datasources,
        settings,
        project: initialValue?.project || project || "",
        initialValue,
        initialHashAttribute,
      }),
      name: initialValue?.name || "",
      disableStickyBucketing: true,
      activationMetric: initialValue?.activationMetric || "",
      hashAttribute: initialHashAttribute,
      hashVersion:
        initialValue?.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
      attributionModel:
        initialValue?.attributionModel ??
        settings?.attributionModel ??
        "firstExposure",
      goalMetrics: initialValue?.goalMetrics || [],
      secondaryMetrics: initialValue?.secondaryMetrics || [],
      tags: initialValue?.tags || [],
      targetURLRegex: initialValue?.targetURLRegex || "",
      description: initialValue?.description || "",
      guardrailMetrics: initialValue?.guardrailMetrics || [],
      variations: initialExpVariations,
      phases: [
        ...(initialValue?.phases?.[lastPhase]
          ? [
              {
                ...initialValue.phases[lastPhase],
                coverage: initialValue.phases?.[lastPhase]?.coverage || 1,
                dateStarted: getValidDate(
                  initialValue.phases?.[lastPhase]?.dateStarted ?? "",
                )
                  .toISOString()
                  .substring(0, 16),
                dateEnded: getValidDate(
                  initialValue.phases?.[lastPhase]?.dateEnded ?? "",
                )
                  .toISOString()
                  .substring(0, 16),
                name: initialValue.phases?.[lastPhase]?.name || "Main",
                reason: "",
                variationWeights:
                  initialValue.phases[lastPhase].variationWeights ??
                  toEqualWeights(initialExpVariations),
                variations:
                  initialValue.phases[lastPhase].variations ??
                  toPhaseVariations(initialExpVariations),
                ...(duplicate ? { seed: undefined } : {}),
              },
            ]
          : [
              {
                coverage: 1,
                dateStarted: new Date().toISOString().substring(0, 16),
                dateEnded: new Date().toISOString().substring(0, 16),
                name: "Main",
                reason: "",
                variationWeights: toEqualWeights(initialExpVariations),
                variations: toPhaseVariations(initialExpVariations),
              },
            ]),
      ],
      status: "draft",
      customFields: initialValue?.customFields,
      regressionAdjustmentEnabled:
        scopedSettings.regressionAdjustmentEnabled.value,
      banditScheduleValue: scopedSettings.banditScheduleValue.value,
      banditScheduleUnit: scopedSettings.banditScheduleUnit.value,
      banditBurnInValue: scopedSettings.banditBurnInValue.value,
      banditBurnInUnit: scopedSettings.banditScheduleUnit.value,
      banditConversionWindowValue: initialValue?.banditConversionWindowValue,
      banditConversionWindowUnit:
        initialValue?.banditConversionWindowUnit ?? "hours",
      customMetricSlices: initialValue?.customMetricSlices || [],
    },
  });

  const selectedProject = form.watch("project");
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    selectedProject,
  );

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const watchedExpVariations = form.watch("variations") ?? [];
  const watchedWeights = form.watch("phases.0.variationWeights") ?? [];
  const combinedVariations = watchedExpVariations.map((v, i) => ({
    id: v.id || "",
    name: v.name,
    key: v.key || `${i}`,
    description: v.description,
    screenshots: v.screenshots,
    weight: watchedWeights[i] ?? 1 / (watchedExpVariations.length || 2),
  }));

  const setCombinedVariations = useCallback(
    (
      v: {
        value?: string;
        id?: string;
        name?: string;
        weight: number;
        description?: string;
        screenshots?: { path: string }[];
      }[],
    ) => {
      const normalizedVariations = v.map((data, i) => ({
        ...data,
        key: data.value ?? `${i}`,
        id: data.id || generateVariationId(),
      }));

      form.setValue(
        "variations",
        normalizedVariations.map((data) => ({
          name: data.name ?? "",
          description: data.description ?? "",
          screenshots: data.screenshots ?? [],
          key: data.key,
          id: data.id,
        })),
      );
      form.setValue(
        "phases.0.variationWeights",
        normalizedVariations.map((data) => data.weight),
      );
      form.setValue(
        "phases.0.variations",
        normalizedVariations.map((data) => ({
          id: data.id,
          status: "active" as const,
        })),
      );
    },
    [form],
  );

  const setVariationWeight = useCallback(
    (i: number, weight: number) => {
      form.setValue(`phases.0.variationWeights.${i}`, weight);
    },
    [form],
  );

  const variationsForInput = combinedVariations.map((v) => ({
    value: v.key || "",
    name: v.name,
    weight: v.weight,
    id: v.id,
    description: v.description,
    screenshots: v.screenshots,
  }));

  const { apiCall } = useAuth();

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const value = { ...rawValue, name: rawValue.name?.trim() };
    if ((value.name?.length ?? 0) < 1) {
      setStep(0);
      throw new Error("Name must not be empty");
    }

    const data = { ...value };

    if (data.status !== "stopped" && data.phases?.[0]) {
      data.phases[0].dateEnded = "";
    }
    if (data.phases?.[0]) {
      if (
        data.phases[0].dateStarted &&
        !data.phases[0].dateStarted.match(/Z$/)
      ) {
        data.phases[0].dateStarted += ":00Z";
      }
      if (data.phases[0].dateEnded && !data.phases[0].dateEnded.match(/Z$/)) {
        data.phases[0].dateEnded += ":00Z";
      }

      validateSavedGroupTargeting(data.phases[0].savedGroups);

      validateAndFixCondition(data.phases[0].condition, (condition) => {
        form.setValue("phases.0.condition", condition);
        forceConditionRender();
      });

      if (prerequisiteTargetingSdkIssues) {
        throw new Error("Prerequisite targeting issues must be resolved");
      }

      validateUnregisteredAttributes(
        {
          hashAttribute: (data as { hashAttribute?: string }).hashAttribute,
          fallbackAttribute: (data as { fallbackAttribute?: string })
            .fallbackAttribute,
          condition: data.phases[0].condition,
        },
        "experiment",
        {
          attributeSchema: allAttributesSchema,
          requireRegisteredAttributes: settings.requireRegisteredAttributes,
          project: data.project || project || undefined,
        },
      );

      if (!hasCommercialFeature("contextual-bandits")) {
        throw new Error("Contextual Bandits are a premium feature");
      }
      if (!data.datasource) {
        throw new Error("You must select a datasource");
      }

      data.statsEngine = "bayesian";
      data.secondaryMetrics = [];
      data.guardrailMetrics = [];
      data.customMetricSlices = [];

      const ds = datasources.find((d) => d.id === data.datasource);
      const queries = ds?.settings?.queries?.exposure ?? [];
      const withTargetingAttributes = queries.filter(
        (q) => (q.targetingAttributeColumns?.length ?? 0) > 0,
      );
      if (queries.length > 0 && withTargetingAttributes.length === 0) {
        setStep(2);
        throw new Error(
          "No Experiment Assignment Tables with targeting attributes exist for this data source. Add attributes to an experiment assignment table on the data source page, then try again.",
        );
      }
      if (withTargetingAttributes.length > 0) {
        const selected = queries.find((q) => q.id === data.exposureQueryId);
        if (
          !selected?.targetingAttributeColumns?.length ||
          !withTargetingAttributes.some((q) => q.id === data.exposureQueryId)
        ) {
          setStep(2);
          throw new Error(
            "Select an Experiment Assignment Table that has targeting attribute columns configured.",
          );
        }
      }

      if ((data.goalMetrics?.length ?? 0) !== 1 || !data.goalMetrics?.[0]) {
        throw new Error("You must select 1 decision metric");
      }
      const goalMetric = getExperimentMetricById(data.goalMetrics[0]);
      if (goalMetric?.datasource !== data.datasource) {
        setStep(2);
        throw new Error(
          "The decision metric must belong to the selected data source",
        );
      }
      const shouldIncludeConversionWindow =
        !disableBanditConversionWindow &&
        (!settings.useStickyBucketing || data.disableStickyBucketing);

      if (!shouldIncludeConversionWindow) {
        delete data.banditConversionWindowValue;
        delete data.banditConversionWindowUnit;
      } else if (
        !data.banditConversionWindowValue ||
        !data.banditConversionWindowUnit
      ) {
        throw new Error(
          "Enter a conversion window override or disable the conversion window override",
        );
      }
    }

    // Preflight tracking-key uniqueness since BaseModel CRUD response lacks the duplicate-key sentinel.
    if (!allowDuplicateTrackingKey && data.trackingKey) {
      const existing = await apiCall<{
        contextualBandits: ApiContextualBanditInterface[];
      }>(
        `/api/v1/contextual-bandits?trackingKey=${encodeURIComponent(
          data.trackingKey,
        )}`,
        { method: "GET" },
      );
      if ((existing.contextualBandits?.length ?? 0) > 0) {
        setAllowDuplicateTrackingKey(true);
        throw new Error(
          "Warning: A Contextual Bandit with that tracking key already exists. To continue anyway, click 'Save' again.",
        );
      }
    }

    // CB create endpoint expects targeting-attribute columns in the POST body.
    const submitDatasource = datasources.find((d) => d.id === data.datasource);
    const submitExposureQuery =
      submitDatasource?.settings?.queries?.exposure?.find(
        (q) => q.id === data.exposureQueryId,
      );
    const submitContextualAttributes =
      submitExposureQuery?.targetingAttributeColumns ?? [];

    const createBody: ApiCreateContextualBanditBody = {
      name: data.name ?? "",
      description: data.description,
      hypothesis: data.hypothesis,
      project: data.project || undefined,
      owner: data.owner || undefined,
      tags: data.tags ?? [],
      customFields: data.customFields,

      trackingKey: data.trackingKey ?? "",
      hashAttribute: data.hashAttribute || undefined,
      fallbackAttribute: data.fallbackAttribute || undefined,
      hashVersion: data.hashVersion as 1 | 2 | undefined,
      disableStickyBucketing: data.disableStickyBucketing ?? true,

      variations: (data.variations ?? []).map((v, i) => ({
        key: v.key || `${i}`,
        name: v.name ?? "",
        description: v.description,
      })),

      datasource: data.datasource ?? "",
      exposureQueryId: data.exposureQueryId ?? "",
      segment: data.segment || undefined,
      queryFilter: data.queryFilter || undefined,
      goalMetrics: data.goalMetrics ?? [],
      secondaryMetrics: data.secondaryMetrics ?? [],
      guardrailMetrics: data.guardrailMetrics ?? [],
      activationMetric: data.activationMetric || undefined,
      attributionModel: data.attributionModel,
      skipPartialData: data.skipPartialData,
      regressionAdjustmentEnabled: data.regressionAdjustmentEnabled,

      contextualAttributes: submitContextualAttributes,
    };

    const res = await apiCall<{
      contextualBandit: ApiContextualBanditInterface;
    }>("/api/v1/contextual-bandits", {
      method: "POST",
      body: JSON.stringify(createBody),
    });

    track("Create Contextual Bandit", {
      source,
      numTags: createBody.tags?.length || 0,
      numMetrics:
        (createBody.goalMetrics?.length || 0) +
        (createBody.secondaryMetrics?.length || 0),
      numVariations: createBody.variations?.length || 0,
    });
    refreshWatching();

    createBody.tags && refreshTags(createBody.tags);

    if (onCreate) {
      onCreate(res.contextualBandit.id);
    } else {
      router.push(`/contextual-bandit/${res.contextualBandit.id}`);
    }
  });

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtils.canViewExperimentModal(p.id))
    .map((p) => ({ value: p.id, label: p.name }));

  const allowAllProjects = permissionsUtils.canViewExperimentModal();
  const hasProjectPermission = selectedProject
    ? permissionsUtils.canViewExperimentModal(selectedProject)
    : allowAllProjects;

  const exposureQueries = useMemo(
    () => datasource?.settings?.queries?.exposure || [],
    [datasource?.settings?.queries?.exposure],
  );
  const exposureQueryId = form.getValues("exposureQueryId");
  const status = form.watch("status");

  useEffect(() => {
    if (!exposureQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const [linkNameWithTrackingKey, setLinkNameWithTrackingKey] = useState(true);

  let header = isNewExperiment
    ? "Add New Contextual Bandit"
    : "Add New Contextual Bandit Analysis";
  if (duplicate) {
    header = "Duplicate Contextual Bandit";
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });
  const trackingKeyFieldHandlers = form.register("trackingKey");

  const { currentProjectIsDemo } = useDemoDataSourceProject();

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        trackingEventModalSource={source}
        header={header}
        close={onClose}
        docSection="experimentConfiguration"
        submit={onSubmit}
        cta={"Save"}
        ctaEnabled={canSubmit && hasProjectPermission}
        disabledMessage={
          !hasProjectPermission
            ? !selectedProject && availableProjects.length > 0
              ? "Select a project to continue."
              : "You don't have permission to create experiments."
            : undefined
        }
        closeCta="Cancel"
        size="lg"
        step={step}
        setStep={setStep}
        inline={inline}
        backButton={true}
      >
        <Page display="Overview">
          <div className="px-2">
            {currentProjectIsDemo && (
              <Callout status="warning" mb="3">
                You are creating an experiment under the demo datasource
                project. This experiment will be deleted when the demo
                datasource project is deleted.
              </Callout>
            )}

            {projects.length >= 1 && !(isNewExperiment || duplicate) && (
              <div className="form-group">
                <label>Project</label>
                <SelectField
                  value={form.watch("project") ?? ""}
                  onChange={(p) => {
                    form.setValue("project", p);
                  }}
                  name="project"
                  initialOption={allowAllProjects ? "All Projects" : undefined}
                  options={availableProjects}
                />
              </div>
            )}

            <Field
              label="Contextual Bandit Name"
              required
              minLength={2}
              {...nameFieldHandlers}
              onChange={async (e) => {
                nameFieldHandlers.onChange(e);

                if (!isNewExperiment) return;
                if (!linkNameWithTrackingKey) return;
                const val = e?.target?.value ?? form.watch("name");
                if (!val) {
                  form.setValue("trackingKey", "");
                  return;
                }
                const trackingKey = await generateTrackingKey(
                  { name: val },
                  async (key: string) =>
                    (experiments.find((exp) => exp.trackingKey === key) as
                      | ExperimentInterfaceStringDates
                      | undefined) ?? null,
                );
                form.setValue("trackingKey", trackingKey);
              }}
            />

            <Field
              label="Tracking Key"
              helpText="Unique identifier for this Contextual Bandit, used to track impressions and analyze results"
              {...trackingKeyFieldHandlers}
              onChange={(e) => {
                trackingKeyFieldHandlers.onChange(e);
                setLinkNameWithTrackingKey(false);
              }}
            />

            {duplicate && (
              <Box mb="4">
                <Checkbox
                  label="Use same randomization seed as original experiment"
                  value={useSameSeedAsOriginal}
                  setValue={(v) => setUseSameSeedAsOriginal(v)}
                  error={
                    useSameSeedAsOriginal
                      ? "Can introduce bias if the original experiment influenced user behavior."
                      : undefined
                  }
                  errorLevel="warning"
                />
              </Box>
            )}

            <Field
              label="Description"
              textarea
              minRows={2}
              {...form.register("description")}
              placeholder="Short human-readable description of the Contextual Bandit"
            />

            {!(isNewExperiment || duplicate) && (
              <div className="form-group">
                <label>Tags</label>
                <TagsInput
                  value={form.watch("tags") ?? []}
                  onChange={(tags) => form.setValue("tags", tags)}
                />
              </div>
            )}

            {!isNewExperiment && (
              <>
                <SelectField
                  label="Status"
                  options={[
                    { label: "draft", value: "draft" },
                    { label: "running", value: "running" },
                    { label: "stopped", value: "stopped" },
                  ]}
                  onChange={(v) => {
                    const s = v as ExperimentStatus;
                    form.setValue("status", s);
                  }}
                  value={form.watch("status") ?? ""}
                  sort={false}
                />
                {status !== "draft" && (
                  <DatePicker
                    label="Start Time (UTC)"
                    date={form.watch("phases.0.dateStarted")}
                    setDate={(v) => {
                      form.setValue(
                        "phases.0.dateStarted",
                        v ? datetime(v) : "",
                      );
                    }}
                    scheduleEndDate={form.watch("phases.0.dateEnded")}
                    disableAfter={form.watch("phases.0.dateEnded") || undefined}
                  />
                )}
                {status === "stopped" && (
                  <DatePicker
                    label="End Time (UTC)"
                    date={form.watch("phases.0.dateEnded")}
                    setDate={(v) => {
                      form.setValue("phases.0.dateEnded", v ? datetime(v) : "");
                    }}
                    scheduleStartDate={form.watch("phases.0.dateStarted")}
                    disableBefore={
                      form.watch("phases.0.dateStarted") || undefined
                    }
                  />
                )}
              </>
            )}

            {hasCommercialFeature("custom-metadata") &&
              !!customFields?.length && (
                <CustomFieldInput
                  customFields={customFields}
                  currentCustomFields={form.watch("customFields") || {}}
                  setCustomFields={(value) => {
                    form.setValue("customFields", value);
                  }}
                  section={"experiment"}
                  project={selectedProject}
                />
              )}
          </div>
        </Page>

        {isNewExperiment || duplicate
          ? ["Overview", "Traffic", "Metrics"].map((p, i) => {
              if (i === 0) return null;
              return (
                <Page display={p} key={i}>
                  <div className="px-2">
                    <BanditRefNewFields
                      step={i}
                      source="experiment"
                      project={project}
                      environments={envs}
                      prerequisiteValue={
                        form.watch("phases.0.prerequisites") || []
                      }
                      setPrerequisiteValue={(prerequisites) =>
                        form.setValue("phases.0.prerequisites", prerequisites)
                      }
                      setPrerequisiteTargetingSdkIssues={
                        setPrerequisiteTargetingSdkIssues
                      }
                      savedGroupValue={form.watch("phases.0.savedGroups") || []}
                      setSavedGroupValue={(savedGroups) =>
                        form.setValue("phases.0.savedGroups", savedGroups)
                      }
                      defaultConditionValue={
                        form.watch("phases.0.condition") || ""
                      }
                      setConditionValue={(value) =>
                        form.setValue("phases.0.condition", value)
                      }
                      conditionKey={conditionKey}
                      namespaceFormPrefix={"phases.0."}
                      coverage={form.watch("phases.0.coverage")}
                      setCoverage={(coverage) =>
                        form.setValue("phases.0.coverage", coverage)
                      }
                      setWeight={setVariationWeight}
                      variations={variationsForInput}
                      setVariations={setCombinedVariations}
                      disableBanditConversionWindow={
                        disableBanditConversionWindow
                      }
                      setDisableBanditConversionWindow={
                        setDisableBanditConversionWindow
                      }
                      contextualBandit={true}
                      setContextualBandit={() => {}}
                      hideContextualBanditToggle={true}
                    />
                  </div>
                </Page>
              );
            })
          : null}
      </PagedModal>
    </FormProvider>
  );
};

export default ContextualBanditForm;
