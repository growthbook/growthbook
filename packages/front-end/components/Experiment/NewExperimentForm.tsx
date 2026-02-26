import React, { FC, useEffect, useState, useCallback, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
  Variation,
} from "shared/types/experiment";
import { useRouter } from "next/router";
import { date, datetime, getValidDate } from "shared/dates";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { OrganizationSettings } from "shared/types/organization";
import { getProviderFromEmbeddingModel } from "shared/ai";
import {
  isProjectListValidForProject,
  validateAndFixCondition,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { generateTrackingKey, getEqualWeights } from "shared/experiments";
import { kebabCase, debounce } from "lodash";
import { Box, Flex, Text, Heading, Separator } from "@radix-ui/themes";
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import { PiCaretDownFill } from "react-icons/pi";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import {
  generateVariationId,
  useAttributeSchema,
  useEnvironments,
} from "@/services/features";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
import { hasOpenAIKey, hasMistralKey, hasGoogleAIKey } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useIncrementer } from "@/hooks/useIncrementer";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import { useUser } from "@/services/UserContext";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import useSDKConnections from "@/hooks/useSDKConnections";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import TagsInput from "@/components/Tags/TagsInput";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import ConditionInput from "@/components/Features/ConditionInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import { useExperiments } from "@/hooks/useExperiments";
import BanditRefNewFields from "@/components/Features/RuleModal/BanditRefNewFields";
import ExperimentRefNewFields from "@/components/Features/RuleModal/ExperimentRefNewFields";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Tooltip from "@/components/Tooltip/Tooltip";
import DatePicker from "@/components/DatePicker";
import { useTemplates } from "@/hooks/useTemplates";
import { convertTemplateToExperiment } from "@/services/experiments";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";
import Link from "@/ui/Link";
import Markdown from "@/components/Markdown/Markdown";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { AppFeatures } from "@/types/app-features";
import { useHoldouts } from "@/hooks/useHoldouts";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
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

export function getDefaultVariations(num: number) {
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

export function getNewExperimentDatasourceDefaults({
  datasources,
  settings,
  project,
  initialValue,
  initialHashAttribute,
}: {
  datasources: DataSourceInterfaceWithParams[];
  settings: OrganizationSettings;
  project?: string;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialHashAttribute?: string;
}): Pick<ExperimentInterfaceStringDates, "datasource" | "exposureQueryId"> {
  const validDatasources = datasources.filter(
    (d) =>
      d.id === initialValue?.datasource ||
      isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasource: "", exposureQueryId: "" };

  const initialId = initialValue?.datasource || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  const initialUserIdType = initialHashAttribute
    ? (initialDatasource.settings?.userIdTypes?.find((t) =>
        t.attributes?.includes(initialHashAttribute),
      )?.userIdType ?? "anonymous_id")
    : "anonymous_id";

  return {
    datasource: initialDatasource.id,
    exposureQueryId:
      getExposureQuery(
        initialDatasource.settings,
        initialValue?.exposureQueryId,
        initialUserIdType,
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
  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] =
    useState(false);
  const [autoRefreshResults, setAutoRefreshResults] = useState(true);

  const { datasources, getDatasourceById, refreshTags, project, projects } =
    useDefinitions();
  const { aiEnabled } = useAISettings();
  const gb = useGrowthBook<AppFeatures>();
  const useCheckForSimilar = gb?.isOn("similar-experiments") || true;
  const [similarExperiments, setSimilarExperiments] = useState<
    { experiment: ExperimentInterfaceStringDates; similarity: number }[]
  >([]);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [enoughWords, setEnoughWords] = useState(false);
  const [missingEmbeddingKey, setMissingEmbeddingKey] = useState<{
    provider: string;
    envVar: string;
  } | null>(null);
  const [expandSimilarResults, setExpandSimilarResults] = useState(false);
  const environments = useEnvironments();
  const { experiments } = useExperiments();
  const holdoutsEnabled = useFeatureIsOn("holdouts_feature");

  const {
    templates: allTemplates,
    templatesMap,
    mutateTemplates: refreshTemplates,
  } = useTemplates();

  const { experimentsMap, holdoutsMap } = useHoldouts();

  const envs = environments.map((e) => e.id);

  const [prerequisiteTargetingSdkIssues, setPrerequisiteTargetingSdkIssues] =
    useState(false);
  const canSubmit = !prerequisiteTargetingSdkIssues;
  const minWordsForSimilarityCheck = 4;

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
  const initialHashAttribute = initialValue?.hashAttribute || hashAttribute;

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
      type: initialValue?.type ?? "standard",
      hypothesis: initialValue?.hypothesis || "",
      activationMetric: initialValue?.activationMetric || "",
      hashAttribute: initialHashAttribute,
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
                  initialValue.phases?.[lastPhase]?.dateStarted ?? "",
                )
                  .toISOString()
                  .substr(0, 16),
                dateEnded: getValidDate(
                  initialValue.phases?.[lastPhase]?.dateEnded ?? "",
                )
                  .toISOString()
                  .substr(0, 16),
                name: initialValue.phases?.[lastPhase]?.name || "Main",
                reason: "",
                variationWeights:
                  initialValue.phases?.[lastPhase]?.variationWeights ||
                  getEqualWeights(
                    initialValue.variations
                      ? initialValue.variations.length
                      : 2,
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
                  )?.length || 2,
                ),
              },
            ]),
      ],
      status: !isImport ? "draft" : initialValue?.status || "running",
      ideaSource: idea || "",
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
      templateId: initialValue?.templateId || "",
      holdoutId: initialValue?.holdoutId || undefined,
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

  const isPipelineIncrementalEnabledForDatasource =
    datasource?.settings.pipelineSettings?.mode === "incremental";
  const willExperimentBeIncludedInIncrementalRefresh =
    isPipelineIncrementalEnabledForDatasource &&
    datasource?.settings.pipelineSettings?.includedExperimentIds === undefined;

  const { apiCall } = useAuth();

  const onSubmit = form.handleSubmit(async (rawValue) => {
    const value = { ...rawValue, name: rawValue.name?.trim() };
    if (value.holdoutId === "") {
      value.holdoutId = undefined;
    }
    // Make sure there's an experiment name
    if ((value.name?.length ?? 0) < 1) {
      setStep(0);
      throw new Error("Name must not be empty");
    }

    if (!value.templateId && templateRequired && !isImport && !duplicate) {
      setStep(0);
      throw new Error("You must select a template");
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
        "Warning: An experiment with that tracking key already exists. To continue anyway, click 'Save' again.",
      );
    }

    // TODO remove if data correlates
    track(isBandit ? "Create Bandit" : "Create Experiment", {
      source,
      numTags: data.tags?.length || 0,
      numMetrics:
        (data.goalMetrics?.length || 0) + (data.secondaryMetrics?.length || 0),
      numVariations: data.variations?.length || 0,
      createdFromTemplate: !!data.templateId,
    });
    refreshWatching();

    data.tags && refreshTags(data.tags);
    data.templateId && refreshTemplates();
    if (onCreate) {
      onCreate(res.experiment.id);
    } else {
      router.push(`/experiment/${res.experiment.id}`);
    }
  });

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtils.canViewExperimentModal(p.id))
    .map((p) => ({ value: p.id, label: p.name }));

  const availableTemplates = allTemplates
    .slice()
    .sort((a, b) =>
      a.templateMetadata.name > b.templateMetadata.name ? 1 : -1,
    )
    .filter((t) =>
      isProjectListValidForProject(t.project ? [t.project] : [], project),
    )
    .map((t) => ({ value: t.id, label: t.templateMetadata.name }));

  const allowAllProjects = permissionsUtils.canViewExperimentModal();

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.getValues("exposureQueryId");
  const status = form.watch("status");
  const type = form.watch("type");
  const isBandit = type === "multi-armed-bandit";

  // If a template id is provided as an initial value, load the template and convert it to an experiment
  useEffect(() => {
    if (initialValue?.templateId && isNewExperiment && !isImport && !isBandit) {
      const template = templatesMap.get(initialValue.templateId);
      if (!template) return;
      const templateAsExperiment = convertTemplateToExperiment(template);

      if (templateAsExperiment.skipPartialData === true) {
        // @ts-expect-error Mangled types
        templateAsExperiment.skipPartialData = "strict";
      } else if (templateAsExperiment.skipPartialData === false) {
        // @ts-expect-error Mangled types
        templateAsExperiment.skipPartialData = "loose";
      }

      form.reset(templateAsExperiment, {
        keepDefaultValues: true,
      });
    }
  }, []);

  // If a holdout is set for a new experiment, use the hash attribute of the holdout experiment
  const holdoutId = form.watch("holdoutId");
  const holdoutExperimentId = holdoutId
    ? holdoutsMap.get(holdoutId)?.experimentId
    : undefined;
  const holdoutHashAttribute = holdoutExperimentId
    ? experimentsMap.get(holdoutExperimentId)?.hashAttribute
    : undefined;

  useEffect(() => {
    if (holdoutId && holdoutHashAttribute) {
      form.setValue("hashAttribute", holdoutHashAttribute);
    }
  }, [holdoutId, holdoutHashAttribute]);

  const templateRequired =
    hasCommercialFeature("templates") &&
    !isBandit &&
    !isImport &&
    settings.requireExperimentTemplates &&
    availableTemplates.length >= 1;

  const { currentProjectIsDemo } = useDemoDataSourceProject();
  useEffect(() => {
    if (!exposureQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const [linkNameWithTrackingKey, setLinkNameWithTrackingKey] = useState(true);

  let header = isNewExperiment
    ? `Add New ${isBandit ? "Bandit" : "Experiment"}`
    : "Add New Experiment Analysis";
  if (duplicate) {
    header = `Duplicate ${isBandit ? "Bandit" : "Experiment"}`;
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });
  const trackingKeyFieldHandlers = form.register("trackingKey");

  const checkForSimilar = useCallback(async () => {
    if (!aiEnabled || !useCheckForSimilar) return;

    // Check if we have the API key for the embedding model provider
    const embeddingModel = settings.embeddingModel || "text-embedding-ada-002";
    let hasEmbeddingKey = false;
    let embeddingProvider = "openai";
    const providerEnvVars: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      mistral: "MISTRAL_API_KEY",
      google: "GOOGLE_AI_API_KEY",
    };
    try {
      embeddingProvider = getProviderFromEmbeddingModel(embeddingModel);
      if (embeddingProvider === "openai") {
        hasEmbeddingKey = hasOpenAIKey();
      } else if (embeddingProvider === "mistral") {
        hasEmbeddingKey = hasMistralKey();
      } else if (embeddingProvider === "google") {
        hasEmbeddingKey = hasGoogleAIKey();
      }
    } catch {
      //  Ignore if we can't determine the provider
    }

    if (!hasEmbeddingKey) {
      setMissingEmbeddingKey({
        provider:
          embeddingProvider.charAt(0).toUpperCase() +
          embeddingProvider.slice(1),
        envVar: providerEnvVars[embeddingProvider] || "API_KEY",
      });
      return;
    }

    setMissingEmbeddingKey(null);

    // check how many words we're sending in the hypothesis, name, and description:
    const wordCount =
      (form.watch("hypothesis")?.split(/\s+/).length || 0) +
      (form.watch("name")?.split(/\s+/).length || 0) +
      (form.watch("description")?.split(/\s+/).length || 0);
    if (wordCount < minWordsForSimilarityCheck) {
      setEnoughWords(false);
      setSimilarExperiments([]);
      return;
    }
    setEnoughWords(true);
    setAiLoading(true);
    try {
      queueCheckForSimilar.cancel();
      const response = await apiCall<{
        status: number;
        message?: string;
        similar?: {
          experiment: ExperimentInterfaceStringDates;
          similarity: number;
        }[];
      }>(`/experiments/similar`, {
        method: "POST",
        body: JSON.stringify({
          hypothesis: form.watch("hypothesis"),
          name: form.watch("name"),
          description: form.watch("description"),
        }),
      });

      if (
        response &&
        response.status === 200 &&
        response.similar &&
        response.similar.length
      ) {
        if (response.similar) {
          setSimilarExperiments(response.similar);
        } else {
          setSimilarExperiments([]);
        }
      } else {
        setSimilarExperiments([]);
      }
      setAiLoading(false);
    } catch (error) {
      // ignore the errors.
      setAiLoading(false);
    }
  }, [form, apiCall]);

  const queueCheckForSimilar = useMemo(
    () =>
      debounce(async () => {
        try {
          await checkForSimilar();
        } catch (error) {
          console.error("Error in checkForSimilar:", error);
        }
      }, 3000),
    [],
  );
  useEffect(() => {
    return () => {
      queueCheckForSimilar.cancel();
    };
  }, [queueCheckForSimilar]);

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
            {availableTemplates.length >= 1 &&
              !isBandit &&
              !isImport &&
              !duplicate && (
                <div className="form-group">
                  <PremiumTooltip commercialFeature="templates">
                    <label>Select Template</label>
                  </PremiumTooltip>
                  <SelectField
                    value={form.watch("templateId") ?? ""}
                    onChange={(t) => {
                      if (t === "") {
                        form.setValue("templateId", undefined);
                        form.reset();
                        return;
                      }
                      form.setValue("templateId", t);
                      // Convert template to experiment interface shape and reset values
                      const template = templatesMap.get(t);
                      if (!template) return;

                      const templateAsExperiment =
                        convertTemplateToExperiment(template);
                      form.reset(templateAsExperiment, {
                        keepDefaultValues: true,
                      });
                    }}
                    name="template"
                    initialOption={"None"}
                    options={availableTemplates}
                    formatOptionLabel={(value) => {
                      const t = templatesMap.get(value.value);
                      if (!t) return <span>{value.label}</span>;
                      return (
                        <Flex as="div" align="baseline">
                          <Text>{value.label}</Text>
                          <Text size="1" className="text-muted" ml="auto">
                            Created {date(t.dateCreated)}
                          </Text>
                        </Flex>
                      );
                    }}
                    helpText={
                      templateRequired
                        ? "Your organization requires experiments to be created from a template"
                        : undefined
                    }
                    disabled={!hasCommercialFeature("templates")}
                    required={templateRequired}
                  />
                </div>
              )}

            {projects.length >= 1 && (
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

            {holdoutsEnabled && (
              <>
                <HoldoutSelect
                  selectedProject={selectedProject}
                  selectedHoldoutId={form.watch("holdoutId")}
                  setHoldout={(holdoutId) => {
                    form.setValue("holdoutId", holdoutId);
                  }}
                  formType="experiment"
                />
                <Separator size="4" mt="5" mb="5" />
              </>
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
                      | undefined) ?? null,
                );
                form.setValue("trackingKey", trackingKey);
                queueCheckForSimilar();
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
                minRows={2}
                placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
                {...form.register("hypothesis", {
                  onChange: () => {
                    queueCheckForSimilar(); // Debounced call
                  },
                  onBlur: () => {
                    // cancel any pending debounced calls
                    queueCheckForSimilar.cancel();
                    checkForSimilar(); // Immediate call on blur
                  },
                })}
              />
            )}
            {includeDescription && (
              <Field
                label="Description"
                textarea
                minRows={2}
                {...form.register("description", {
                  onChange: () => {
                    queueCheckForSimilar(); // Debounced call
                  },
                  onBlur: () => {
                    // cancel any pending debounced calls
                    queueCheckForSimilar.cancel();
                    checkForSimilar(); // Immediate call on blur
                  },
                })}
                placeholder={`Short human-readable description of the ${
                  isBandit ? "Bandit" : "Experiment"
                }`}
              />
            )}
            {useCheckForSimilar && (
              <>
                {missingEmbeddingKey ? (
                  <Box my="4">
                    <Callout status="warning">
                      {missingEmbeddingKey.provider} API key is required for
                      checking similar experiments. Please set{" "}
                      <code>{missingEmbeddingKey.envVar}</code> in your
                      environment variables.
                    </Callout>
                  </Box>
                ) : !enoughWords ? (
                  <Box my="4">
                    <Flex gap="2" className="text-muted" align="center">
                      <FaExclamationCircle />
                      <Text size="2" weight="light">
                        Enter more details to check for similar experiments
                      </Text>
                    </Flex>
                  </Box>
                ) : (
                  <>
                    {aiLoading ? (
                      <Box my="4">
                        <Flex gap="2" className="text-muted">
                          <LoadingSpinner />
                          <Text size="2">
                            Checking for similar experiments...
                          </Text>
                        </Flex>
                      </Box>
                    ) : (
                      <>
                        <Box my="4">
                          <Text size="2" color="violet">
                            {similarExperiments.length > 0 ? (
                              <Flex
                                onClick={(e) => {
                                  e.preventDefault();
                                  setExpandSimilarResults(
                                    !expandSimilarResults,
                                  );
                                }}
                                gap="2"
                                align="center"
                              >
                                <PiCaretDownFill
                                  style={{
                                    transition: "transform 0.3s ease",
                                    transform: expandSimilarResults
                                      ? "none"
                                      : "rotate(-90deg)",
                                  }}
                                />
                                <Text
                                  weight="medium"
                                  style={{
                                    cursor: "pointer",
                                    color: "violet-11",
                                  }}
                                >
                                  Similar experiment
                                  {similarExperiments.length === 1 ? "" : "s"} (
                                  {similarExperiments.length})
                                </Text>
                              </Flex>
                            ) : (
                              <Flex gap="2" align="center">
                                <FaCheckCircle />
                                No similar experiments found
                              </Flex>
                            )}
                          </Text>
                          {expandSimilarResults && (
                            <Flex
                              gap="3"
                              direction="column"
                              my="3"
                              p="4"
                              style={{
                                backgroundColor: "var(--accent-a3)",
                                borderRadius: "4px",
                              }}
                            >
                              {similarExperiments.map((s, i) => (
                                <Box
                                  key={`similar-${i}`}
                                  className="appbox"
                                  p="3"
                                  width="100%"
                                  style={{
                                    marginBottom: 0,
                                    maxHeight: "430px",
                                    overflowY: "auto",
                                    color: "var(--text-color-main)",
                                  }}
                                >
                                  <Flex
                                    direction="column"
                                    gap="3"
                                    justify="start"
                                  >
                                    <Flex gap="3" justify="between">
                                      <Flex gap="3" align="start">
                                        <Link
                                          href="/experiment/[id]"
                                          as={`/experiment/${s.experiment.id}`}
                                          target="_blank"
                                        >
                                          <Heading size="2">
                                            {s.experiment.name}
                                          </Heading>
                                        </Link>
                                        <span style={{ fontSize: "0.8rem" }}>
                                          <FaExternalLinkAlt />
                                        </span>
                                      </Flex>
                                      <Flex gap="3" align="center">
                                        <Text size="1" className="text-muted">
                                          {date(s.experiment.dateCreated)}
                                        </Text>
                                        <ExperimentStatusIndicator
                                          experimentData={s.experiment}
                                        />
                                      </Flex>
                                    </Flex>
                                    {s.experiment.description && (
                                      <Box style={{ fontSize: "0.9em" }}>
                                        <strong>Description:</strong>{" "}
                                        <Markdown>
                                          {s.experiment.description}
                                        </Markdown>
                                      </Box>
                                    )}
                                    <Box style={{ fontSize: "0.9em" }}>
                                      <strong>Hypothesis:</strong>{" "}
                                      <Markdown>
                                        {s.experiment.hypothesis}
                                      </Markdown>
                                    </Box>
                                  </Flex>
                                </Box>
                              ))}
                            </Flex>
                          )}
                        </Box>
                      </>
                    )}
                  </>
                )}
              </>
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

        {/* Standard Experiments */}
        {!isBandit && (isNewExperiment || duplicate)
          ? ["Overview", "Traffic", "Targeting", "Metrics"].map((p, i) => {
              // skip, custom overview page above
              if (i === 0) return null;
              return (
                <Page display={p} key={i}>
                  <div className="px-2">
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
                            weight: form.watch(
                              `phases.0.variationWeights.${i}`,
                            ),
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
                          }),
                        );
                        form.setValue(
                          "phases.0.variationWeights",
                          v.map((v) => v.weight),
                        );
                      }}
                      variationValuesAsIds={true}
                      hideVariationIds={!isImport}
                      orgStickyBucketing={orgStickyBucketing}
                      holdoutHashAttribute={holdoutHashAttribute}
                    />
                  </div>
                </Page>
              );
            })
          : null}

        {/* Bandit Experiments */}
        {isBandit && (isNewExperiment || duplicate)
          ? ["Overview", "Traffic", "Targeting", "Metrics"].map((p, i) => {
              // skip, custom overview page above
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
                      setWeight={(i, weight) =>
                        form.setValue(`phases.0.variationWeights.${i}`, weight)
                      }
                      variations={
                        form.watch("variations")?.map((v, i) => {
                          return {
                            value: v.key || "",
                            name: v.name,
                            weight: form.watch(
                              `phases.0.variationWeights.${i}`,
                            ),
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
                          }),
                        );
                        form.setValue(
                          "phases.0.variationWeights",
                          v.map((v) => v.weight),
                        );
                      }}
                    />
                  </div>
                </Page>
              );
            })
          : null}

        {/* Imported Experiments */}
        {!(isNewExperiment || duplicate) ? (
          <Page display="Targeting">
            <div>
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
                  <PrerequisiteInput
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
                valueAsId={false}
                startEditingIndexes={true}
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
                    }),
                  );
                  form.setValue(
                    "phases.0.variationWeights",
                    v.map((v) => v.weight),
                  );
                }}
                hideVariationIds={false}
                showPreview={!!isNewExperiment}
                disableCustomSplit={type === "multi-armed-bandit"}
              />
            </div>
          </Page>
        ) : null}

        {!(isNewExperiment || duplicate) ? (
          <Page display="Metrics">
            <div style={{ minHeight: 350 }}>
              {(!isImport || fromFeature) && (
                <SelectField
                  label="Data Source"
                  labelClassName="font-weight-bold"
                  value={form.watch("datasource") ?? ""}
                  onChange={(v) => form.setValue("datasource", v)}
                  placeholder="Select..."
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

              <ExperimentMetricsSelector
                datasource={datasource?.id}
                noLegacyMetrics={willExperimentBeIncludedInIncrementalRefresh}
                excludeQuantiles={willExperimentBeIncludedInIncrementalRefresh}
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
                experimentId={initialValue?.id}
              />
            </div>

            {isImport && (
              <Checkbox
                id="auto_refresh_results"
                label="Auto Refresh Results"
                description="Populate results on save"
                value={autoRefreshResults}
                setValue={setAutoRefreshResults}
                ml="2"
              />
            )}
          </Page>
        ) : null}
      </PagedModal>
    </FormProvider>
  );
};

export default NewExperimentForm;
