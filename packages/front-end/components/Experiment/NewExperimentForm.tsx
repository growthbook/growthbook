import React, { FC, useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
  Variation,
} from "back-end/types/experiment";
import { useRouter } from "next/router";
import { getValidDate } from "shared/dates";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { OrganizationSettings } from "back-end/types/organization";
import {
  isProjectListValidForProject,
  validateAndFixCondition,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { generateTrackingKey, getEqualWeights } from "shared/experiments";
import { kebabCase } from "lodash";
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import {
  generateVariationId,
  useAttributeSchema,
  useEnvironments,
} from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useIncrementer } from "@/hooks/useIncrementer";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import TagsInput from "@/components/Tags/TagsInput";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ConditionInput from "@/components/Features/ConditionInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import { useExperiments } from "@/hooks/useExperiments";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import Callout from "@/components/Radix/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type NewExperimentFormProps = {
  initialStep?: number;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialNumVariations?: number;
  isImport?: boolean;
  fromFeature?: boolean;
  includeDescription?: boolean;
  duplicate?: boolean;
  source: string;
  idea?: string;
  msg?: string;
  onClose?: () => void;
  onCreate?: (id: string) => void;
  inline?: boolean;
  isNewExperiment?: boolean;
};

function getDefaultVariations(num: number) {
  // Must have at least 2 variations
  num = Math.max(2, num);

  const variations: Variation[] = [];
  for (let i = 0; i < num; i++) {
    variations.push({
      name: i ? `Variation ${i}` : "Control",
      description: "",
      key: i + "",
      screenshots: [],
      id: generateVariationId(),
    });
  }
  return variations;
}

export function getNewExperimentDatasourceDefaults(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
  initialValue?: Partial<ExperimentInterfaceStringDates>
): Pick<ExperimentInterfaceStringDates, "datasource" | "exposureQueryId"> {
  const validDatasources = datasources.filter(
    (d) =>
      d.id === initialValue?.datasource ||
      isProjectListValidForProject(d.projects, project)
  );

  if (!validDatasources.length) return { datasource: "", exposureQueryId: "" };

  const initialId = initialValue?.datasource || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  return {
    datasource: initialDatasource.id,
    exposureQueryId:
      getExposureQuery(
        initialDatasource.settings,
        initialValue?.exposureQueryId,
        initialValue?.userIdType
      )?.id || "",
  };
}

const NewExperimentForm: FC<NewExperimentFormProps> = ({
  initialStep = 0,
  initialValue = {
    type: "standard",
  },
  initialNumVariations = 2,
  onClose,
  onCreate = null,
  isImport,
  fromFeature,
  includeDescription = true,
  duplicate,
  source,
  idea,
  msg,
  inline,
  isNewExperiment,
}) => {
  const { organization, hasCommercialFeature } = useUser();

  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);
  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );
  const [autoRefreshResults, setAutoRefreshResults] = useState(true);

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
  } = useDefinitions();

  const environments = useEnvironments();
  const { experiments } = useExperiments();
  const envs = environments.map((e) => e.id);

  const [
    prerequisiteTargetingSdkIssues,
    setPrerequisiteTargetingSdkIssues,
  ] = useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;

  const settings = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    experiment: (initialValue ?? undefined) as
      | ExperimentInterfaceStringDates
      | undefined,
  });
  const { refreshWatching } = useWatching();

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project
  );

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema(false, project);
  const hashAttributes =
    attributeSchema?.filter((a) => a.hashAttribute)?.map((a) => a.property) ||
    [];
  const hasHashAttributes = hashAttributes.length > 0;
  const hashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const orgStickyBucketing = !!settings.useStickyBucketing;
  const lastPhase = (initialValue?.phases?.length ?? 1) - 1;

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialValue?.project || project || "",
      trackingKey: initialValue?.trackingKey || "",
      ...getNewExperimentDatasourceDefaults(
        datasources,
        settings,
        initialValue?.project || project || "",
        initialValue
      ),
      name: initialValue?.name || "",
      type: initialValue?.type ?? "standard",
      hypothesis: initialValue?.hypothesis || "",
      activationMetric: initialValue?.activationMetric || "",
      hashAttribute: initialValue?.hashAttribute || hashAttribute,
      hashVersion:
        initialValue?.hashVersion || (hasSDKWithNoBucketingV2 ? 1 : 2),
      disableStickyBucketing: initialValue?.disableStickyBucketing ?? false,
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
      variations: initialValue?.variations
        ? initialValue.variations
        : getDefaultVariations(initialNumVariations),
      phases: [
        ...(initialValue?.phases?.[lastPhase]
          ? [
              {
                ...initialValue.phases[lastPhase],
                coverage: initialValue.phases?.[lastPhase]?.coverage || 1,
                dateStarted: getValidDate(
                  initialValue.phases?.[lastPhase]?.dateStarted ?? ""
                )
                  .toISOString()
                  .substr(0, 16),
                dateEnded: getValidDate(
                  initialValue.phases?.[lastPhase]?.dateEnded ?? ""
                )
                  .toISOString()
                  .substr(0, 16),
                name: initialValue.phases?.[lastPhase]?.name || "Main",
                reason: "",
                variationWeights:
                  initialValue.phases?.[lastPhase]?.variationWeights ||
                  getEqualWeights(
                    initialValue.variations ? initialValue.variations.length : 2
                  ),
              },
            ]
          : [
              {
                coverage: 1,
                dateStarted: new Date().toISOString().substr(0, 16),
                dateEnded: new Date().toISOString().substr(0, 16),
                name: "Main",
                reason: "",
                variationWeights: getEqualWeights(
                  (initialValue?.variations
                    ? initialValue.variations
                    : getDefaultVariations(initialNumVariations)
                  )?.length || 2
                ),
              },
            ]),
      ],
      status: !isImport ? "draft" : initialValue?.status || "running",
      ideaSource: idea || "",
      regressionAdjustmentEnabled:
        scopedSettings.regressionAdjustmentEnabled.value,
      banditScheduleValue: scopedSettings.banditScheduleValue.value,
      banditScheduleUnit: scopedSettings.banditScheduleUnit.value,
      banditBurnInValue: scopedSettings.banditBurnInValue.value,
      banditBurnInUnit: scopedSettings.banditScheduleUnit.value,
    },
  });

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const { apiCall } = useAuth();

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const value = { ...rawValue, name: rawValue.name?.trim() };

    // Make sure there's an experiment name
    if ((value.name?.length ?? 0) < 1) {
      setStep(0);
      throw new Error("Name must not be empty");
    }

    const data = { ...value };

    if (data.status !== "stopped" && data.phases?.[0]) {
      data.phases[0].dateEnded = "";
    }
    // Turn phase dates into proper UTC timestamps
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

      // bandits
      if (
        data.type === "multi-armed-bandit" &&
        !hasCommercialFeature("multi-armed-bandits")
      ) {
        throw new Error("Bandits are a premium feature");
      }
      if (data.type === "multi-armed-bandit") {
        data.statsEngine = "bayesian";
        if (!data.datasource) {
          throw new Error("You must select a datasource");
        }
        if ((data.goalMetrics?.length ?? 0) !== 1) {
          throw new Error("You must select 1 decision metric");
        }
      }
    }

    const body = JSON.stringify(data);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {};
    if (allowDuplicateTrackingKey) {
      params.allowDuplicateTrackingKey = true;
    }
    if (duplicate && initialValue?.id) {
      params.originalId = initialValue.id;
    }

    if (autoRefreshResults && isImport) {
      params.autoRefreshResults = true;
    }

    const res = await apiCall<
      | { experiment: ExperimentInterfaceStringDates }
      | { duplicateTrackingKey: true; existingId: string }
    >(`/experiments?${new URLSearchParams(params).toString()}`, {
      method: "POST",
      body,
    });

    if ("duplicateTrackingKey" in res) {
      setAllowDuplicateTrackingKey(true);
      throw new Error(
        "Warning: An experiment with that tracking key already exists. To continue anyway, click 'Save' again."
      );
    }

    // TODO remove if data correlates
    track(isBandit ? "CreateBandit" : "Create Experiment", {
      source,
      numTags: data.tags?.length || 0,
      numMetrics:
        (data.goalMetrics?.length || 0) + (data.secondaryMetrics?.length || 0),
      numVariations: data.variations?.length || 0,
    });
    refreshWatching();

    data.tags && refreshTags(data.tags);
    if (onCreate) {
      onCreate(res.experiment.id);
    } else {
      router.push(`/experiment/${res.experiment.id}`);
    }
  });

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.getValues("exposureQueryId");
  const status = form.watch("status");
  const type = form.watch("type");
  const isBandit = type === "multi-armed-bandit";

  const { currentProjectIsDemo } = useDemoDataSourceProject();

  useEffect(() => {
    if (!exposureQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const [linkNameWithTrackingKey, setLinkNameWithTrackingKey] = useState(true);

  let header = isNewExperiment
    ? `Add new ${isBandit ? "Bandit" : "Experiment"}`
    : "Add new Experiment Analysis";
  if (duplicate) {
    header = `Duplicate ${isBandit ? "Bandit" : "Experiment"}`;
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });
  const trackingKeyFieldHandlers = form.register("trackingKey");

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
        ctaEnabled={canSubmit}
        closeCta="Cancel"
        size="lg"
        step={step}
        setStep={setStep}
        inline={inline}
        backButton={true}
      >
        <Page display="Overview">
          <div className="px-2">
            {msg && <div className="alert alert-info">{msg}</div>}

            {currentProjectIsDemo && (
              <div className="alert alert-warning">
                You are creating an experiment under the demo datasource
                project. This experiment will be deleted when the demo
                datasource project is deleted.
              </div>
            )}

            <Field
              label={isBandit ? "Bandit Name" : "Experiment Name"}
              required
              minLength={2}
              {...nameFieldHandlers}
              onChange={async (e) => {
                // Ensure the name field is updated and then sync with trackingKey if possible
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
                      | undefined) ?? null
                );
                form.setValue("trackingKey", trackingKey);
              }}
            />

            <Field
              label="Tracking Key"
              helpText={`Unique identifier for this ${
                isBandit ? "Bandit" : "Experiment"
              }, used to track impressions and analyze results`}
              {...trackingKeyFieldHandlers}
              onChange={(e) => {
                trackingKeyFieldHandlers.onChange(e);
                setLinkNameWithTrackingKey(false);
              }}
            />

            {!isBandit && (
              <Field
                label="Hypothesis"
                textarea
                minRows={1}
                placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
                {...form.register("hypothesis")}
              />
            )}
            {includeDescription && (
              <Field
                label="Description"
                textarea
                minRows={1}
                {...form.register("description")}
                placeholder={`Short human-readable description of the ${
                  isBandit ? "Bandit" : "Experiment"
                }`}
              />
            )}
            <div className="form-group">
              <label>Tags</label>
              <TagsInput
                value={form.watch("tags") ?? []}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </div>
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
                    const status = v as ExperimentStatus;
                    form.setValue("status", status);
                  }}
                  value={form.watch("status") ?? ""}
                  sort={false}
                />
                {status !== "draft" && (
                  <Field
                    label="Start Date (UTC)"
                    type="datetime-local"
                    {...form.register("phases.0.dateStarted")}
                  />
                )}
                {status === "stopped" && (
                  <Field
                    label="End Date (UTC)"
                    type="datetime-local"
                    {...form.register("phases.0.dateEnded")}
                  />
                )}
              </>
            )}
          </div>
        </Page>

        {!isBandit && (isNewExperiment || duplicate)
          ? ["Overview", "Traffic", "Targeting"].map((p, i) => {
              // skip, custom overview page above
              if (i === 0) return null;
              return (
                <Page display={p} key={i}>
                  <ExperimentRefNewFields
                    step={i}
                    source="experiment"
                    project={project}
                    environments={envs}
                    noSchedule={true}
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
                    setWeight={(i, weight) =>
                      form.setValue(`phases.0.variationWeights.${i}`, weight)
                    }
                    variations={
                      form.watch("variations")?.map((v, i) => {
                        return {
                          value: v.key || "",
                          name: v.name,
                          weight: form.watch(`phases.0.variationWeights.${i}`),
                          id: v.id,
                        };
                      }) ?? []
                    }
                    setVariations={(v) => {
                      form.setValue(
                        "variations",
                        v.map((data, i) => {
                          return {
                            // default values
                            name: "",
                            screenshots: [],
                            ...data,
                            key: data.value || `${i}` || "",
                          };
                        })
                      );
                      form.setValue(
                        "phases.0.variationWeights",
                        v.map((v) => v.weight)
                      );
                    }}
                    orgStickyBucketing={orgStickyBucketing}
                  />
                </Page>
              );
            })
          : null}

        {isBandit && (isNewExperiment || duplicate)
          ? [
              "Overview",
              "Traffic",
              "Targeting",
              <>
                Analysis
                <br />
                Settings
              </>,
            ].map((p, i) => {
              // skip, custom overview page above
              if (i === 0) return null;
              return (
                <Page display={p} key={i}>
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
                    setWeight={(i, weight) =>
                      form.setValue(`phases.0.variationWeights.${i}`, weight)
                    }
                    variations={
                      form.watch("variations")?.map((v, i) => {
                        return {
                          value: v.key || "",
                          name: v.name,
                          weight: form.watch(`phases.0.variationWeights.${i}`),
                          id: v.id,
                        };
                      }) ?? []
                    }
                    setVariations={(v) => {
                      form.setValue(
                        "variations",
                        v.map((data, i) => {
                          return {
                            // default values
                            name: "",
                            screenshots: [],
                            ...data,
                            key: data.value || `${i}` || "",
                          };
                        })
                      );
                      form.setValue(
                        "phases.0.variationWeights",
                        v.map((v) => v.weight)
                      );
                    }}
                  />
                </Page>
              );
            })
          : null}

        {!(isNewExperiment || duplicate) ? (
          <Page display="Targeting">
            <div className="px-2">
              {isNewExperiment && (
                <>
                  <div className="d-flex" style={{ gap: "2rem" }}>
                    <SelectField
                      containerClassName="flex-1"
                      label="Assign variation based on attribute"
                      labelClassName="font-weight-bold"
                      options={attributeSchema
                        .filter((s) => !hasHashAttributes || s.hashAttribute)
                        .map((s) => ({
                          label: s.property,
                          value: s.property,
                        }))}
                      sort={false}
                      value={form.watch("hashAttribute") || ""}
                      onChange={(v) => {
                        form.setValue("hashAttribute", v);
                      }}
                      helpText={
                        "Will be hashed together with the seed (UUID) to determine which variation to assign"
                      }
                    />
                    <FallbackAttributeSelector
                      form={form}
                      attributeSchema={attributeSchema}
                    />
                  </div>

                  {hasSDKWithNoBucketingV2 && (
                    <HashVersionSelector
                      value={(form.watch("hashVersion") || 1) as 1 | 2}
                      onChange={(v) => form.setValue("hashVersion", v)}
                      project={project}
                    />
                  )}

                  <hr />
                  <SavedGroupTargetingField
                    value={form.watch("phases.0.savedGroups") || []}
                    setValue={(savedGroups) =>
                      form.setValue("phases.0.savedGroups", savedGroups)
                    }
                    project={project}
                  />
                  <hr />
                  <ConditionInput
                    defaultValue={form.watch("phases.0.condition") || ""}
                    onChange={(value) =>
                      form.setValue("phases.0.condition", value)
                    }
                    key={conditionKey}
                    project={project}
                  />
                  <hr />
                  <PrerequisiteTargetingField
                    value={form.watch("phases.0.prerequisites") || []}
                    setValue={(prerequisites) =>
                      form.setValue("phases.0.prerequisites", prerequisites)
                    }
                    environments={envs}
                    project={form.watch("project")}
                    setPrerequisiteTargetingSdkIssues={
                      setPrerequisiteTargetingSdkIssues
                    }
                  />
                  <hr />
                  <NamespaceSelector
                    formPrefix="phases.0."
                    form={form}
                    featureId={""}
                    trackingKey={""}
                  />
                </>
              )}

              <hr />
              {isImport && (
                <Callout status="info" mb="3">
                  We&apos;ve guessed the variation weights below based on the
                  data we&apos;ve seen. They may need to be adjusted.
                </Callout>
              )}
              <FeatureVariationsInput
                valueType="string"
                coverage={form.watch("phases.0.coverage")}
                setCoverage={(coverage) =>
                  form.setValue("phases.0.coverage", coverage)
                }
                coverageTooltip={
                  isNewExperiment
                    ? "This can be changed later"
                    : "This is just for documentation purposes and has no effect on the analysis."
                }
                setWeight={(i, weight) =>
                  form.setValue(`phases.0.variationWeights.${i}`, weight)
                }
                valueAsId={true}
                variations={
                  form.watch("variations")?.map((v, i) => {
                    return {
                      value: v.key || "",
                      name: v.name,
                      weight: form.watch(`phases.0.variationWeights.${i}`),
                      id: v.id,
                    };
                  }) ?? []
                }
                setVariations={(v) => {
                  form.setValue(
                    "variations",
                    v.map((data, i) => {
                      return {
                        name: "",
                        screenshots: [],
                        ...data,
                        // use value as key if provided to maintain backwards compatibility
                        key: data.value || `${i}` || "",
                      };
                    })
                  );
                  form.setValue(
                    "phases.0.variationWeights",
                    v.map((v) => v.weight)
                  );
                }}
                showPreview={!!isNewExperiment}
                disableCustomSplit={type === "multi-armed-bandit"}
              />
            </div>
          </Page>
        ) : null}

        {!(isNewExperiment || duplicate) ? (
          <Page
            display={
              <>
                Analysis
                <br />
                Settings
              </>
            }
          >
            <div className="px-2" style={{ minHeight: 350 }}>
              {(!isImport || fromFeature) && (
                <SelectField
                  label="Data Source"
                  labelClassName="font-weight-bold"
                  value={form.watch("datasource") ?? ""}
                  onChange={(v) => form.setValue("datasource", v)}
                  initialOption="Manual"
                  options={datasources.map((d) => {
                    const isDefaultDataSource =
                      d.id === settings.defaultDataSource;
                    return {
                      value: d.id,
                      label: `${d.name}${
                        d.description ? ` — ${d.description}` : ""
                      }${isDefaultDataSource ? " (default)" : ""}`,
                    };
                  })}
                  className="portal-overflow-ellipsis"
                />
              )}
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
                  initialOption="Choose..."
                  required
                  options={exposureQueries?.map((q) => {
                    return {
                      label: q.name,
                      value: q.id,
                    };
                  })}
                  formatOptionLabel={({ label, value }) => {
                    const userIdType = exposureQueries?.find(
                      (e) => e.id === value
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

              <ExperimentMetricsSelector
                datasource={datasource?.id}
                exposureQueryId={exposureQueryId}
                project={project}
                goalMetrics={form.watch("goalMetrics") ?? []}
                secondaryMetrics={form.watch("secondaryMetrics") ?? []}
                guardrailMetrics={form.watch("guardrailMetrics") ?? []}
                setGoalMetrics={(goalMetrics) =>
                  form.setValue("goalMetrics", goalMetrics)
                }
                setSecondaryMetrics={(secondaryMetrics) =>
                  form.setValue("secondaryMetrics", secondaryMetrics)
                }
                setGuardrailMetrics={(guardrailMetrics) =>
                  form.setValue("guardrailMetrics", guardrailMetrics)
                }
              />
            </div>

            {isImport && (
              <div className="form-group">
                <Toggle
                  id="auto_refresh_results"
                  label="Auto Refresh Results"
                  value={autoRefreshResults}
                  setValue={setAutoRefreshResults}
                />
                <label>Populate Results on Save</label>
              </div>
            )}
          </Page>
        ) : null}
      </PagedModal>
    </FormProvider>
  );
};

export default NewExperimentForm;
