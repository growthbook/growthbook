import React, { FC, useState, useCallback } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
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
import {
  generateTrackingKey,
  getEqualWeights,
  getMetricWindowHours,
} from "shared/experiments";
import { kebabCase } from "lodash";
import { Separator } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  generateVariationId,
  useAttributeSchema,
  validateUnregisteredAttributes,
} from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useIncrementer } from "@/hooks/useIncrementer";
import { useUser } from "@/services/UserContext";
import TagsInput from "@/components/Tags/TagsInput";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useExperiments } from "@/hooks/useExperiments";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import ContextualBanditAnalysisFields from "@/components/ContextualBandit/ContextualBanditAnalysisFields";
import ContextualBanditAssignmentAttributeSelect from "@/components/ContextualBandit/ContextualBanditAssignmentAttributeSelect";
import DatePicker from "@/components/DatePicker";
import {
  getDefaultVariations,
  getNewExperimentDatasourceDefaults,
} from "@/components/Experiment/NewExperimentForm";

type ContextualBanditFormValues = Partial<ExperimentInterfaceStringDates> &
  Partial<
    Pick<
      ExperimentPhaseStringDates,
      | "coverage"
      | "condition"
      | "savedGroups"
      | "prerequisites"
      | "variationWeights"
      | "dateStarted"
      | "dateEnded"
    >
  > & {
    decisionMetric?: string;
  };

export type ContextualBanditFormProps = {
  initialStep?: number;
  initialValue?: ContextualBanditFormValues;
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

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
    projects,
    getExperimentMetricById,
  } = useDefinitions();
  const { experiments } = useExperiments();

  const [prerequisiteTargetingSdkIssues] = useState(false);
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

  const [, forceConditionRender] = useIncrementer();

  const allAttributesSchema = useAttributeSchema(false);
  const attributeSchema = useAttributeSchema(false, project);
  const hashAttributes =
    attributeSchema?.filter((a) => a.hashAttribute)?.map((a) => a.property) ||
    [];
  const hashAttribute = hashAttributes.includes("id")
    ? "id"
    : hashAttributes[0] || "id";

  const initialHashAttribute = initialValue?.hashAttribute || hashAttribute;

  const initialExpVariations =
    initialValue?.variations ?? getDefaultVariations(initialNumVariations);
  const toEqualWeights = (vars: Variation[]) => getEqualWeights(vars.length);

  // TODO(holdout-v1.5): wire up holdout configuration UI when back-end is ready.
  const form = useForm<ContextualBanditFormValues>({
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
      hashAttribute: initialHashAttribute,
      decisionMetric: initialValue?.decisionMetric ?? "",
      tags: initialValue?.tags || [],
      targetURLRegex: initialValue?.targetURLRegex || "",
      description: initialValue?.description || "",
      variations: initialExpVariations,
      coverage: initialValue?.coverage ?? 1,
      condition: initialValue?.condition,
      savedGroups: initialValue?.savedGroups,
      prerequisites: initialValue?.prerequisites,
      variationWeights:
        initialValue?.variationWeights ?? toEqualWeights(initialExpVariations),
      dateStarted: getValidDate(initialValue?.dateStarted ?? "")
        .toISOString()
        .substring(0, 16),
      dateEnded: getValidDate(initialValue?.dateEnded ?? "")
        .toISOString()
        .substring(0, 16),
      status: "draft",
      banditScheduleValue: scopedSettings.banditScheduleValue.value,
      banditScheduleUnit: scopedSettings.banditScheduleUnit.value,
      banditBurnInValue: scopedSettings.banditBurnInValue.value,
      banditBurnInUnit: scopedSettings.banditBurnInUnit.value,
      banditConversionWindowValue: initialValue?.banditConversionWindowValue,
      banditConversionWindowUnit:
        initialValue?.banditConversionWindowUnit ?? "hours",
      customMetricSlices: initialValue?.customMetricSlices || [],
    },
  });

  const selectedProject = form.watch("project");

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;
  const { contextualBanditQueries: cbQueries } = useContextualBanditQueries(
    datasource?.id,
  );

  const watchedExpVariations = form.watch("variations") ?? [];
  const watchedWeights = form.watch("variationWeights") ?? [];
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
        "variationWeights",
        normalizedVariations.map((data) => data.weight),
      );
    },
    [form],
  );

  const setVariationWeight = useCallback(
    (i: number, weight: number) => {
      form.setValue(`variationWeights.${i}`, weight);
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

    if (data.status !== "stopped") {
      data.dateEnded = "";
    }
    if (data.dateStarted && !data.dateStarted.match(/Z$/)) {
      data.dateStarted += ":00Z";
    }
    if (data.dateEnded && !data.dateEnded.match(/Z$/)) {
      data.dateEnded += ":00Z";
    }

    validateSavedGroupTargeting(data.savedGroups);

    validateAndFixCondition(data.condition, (condition) => {
      form.setValue("condition", condition);
      forceConditionRender();
    });

    if (prerequisiteTargetingSdkIssues) {
      throw new Error("Prerequisite targeting issues must be resolved");
    }

    validateUnregisteredAttributes(
      {
        hashAttribute: (data as { hashAttribute?: string }).hashAttribute,
        condition: data.condition,
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
    data.customMetricSlices = [];

    const selectedCbQuery = cbQueries.find(
      (q) => q.id === data.exposureQueryId,
    );
    if (!selectedCbQuery) {
      setStep(1);
      throw new Error(
        "Select a Contextual Bandit query for this data source. If none exist yet, create one first.",
      );
    }

    if (!data.decisionMetric) {
      throw new Error("You must select 1 decision metric");
    }
    const decisionMetric = getExperimentMetricById(data.decisionMetric);
    if (decisionMetric?.datasource !== data.datasource) {
      setStep(1);
      throw new Error(
        "The decision metric must belong to the selected data source",
      );
    }

    const cadenceHours =
      parseFloat(String(data.banditScheduleValue ?? "0")) *
      (data.banditScheduleUnit === "days" ? 24 : 1);
    const overrideConversionWindowHours =
      data.banditConversionWindowValue && data.banditConversionWindowUnit
        ? parseFloat(String(data.banditConversionWindowValue)) *
          (data.banditConversionWindowUnit === "days" ? 24 : 1)
        : null;
    const decisionMetricConversionWindow =
      decisionMetric?.windowSettings?.type === "conversion"
        ? decisionMetric.windowSettings
        : null;
    const effectiveConversionWindowHours =
      overrideConversionWindowHours ??
      (decisionMetricConversionWindow
        ? getMetricWindowHours(decisionMetricConversionWindow)
        : null);
    if (
      cadenceHours > 0 &&
      effectiveConversionWindowHours != null &&
      cadenceHours < effectiveConversionWindowHours * 10
    ) {
      setStep(1);
      throw new Error(
        "The decision metric conversion window must be at most 10% of the update cadence. Decrease the conversion window or increase the cadence.",
      );
    }

    const shouldIncludeConversionWindow = !disableBanditConversionWindow;

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

    const submitContextualAttributes =
      cbQueries.find((q) => q.id === data.exposureQueryId)
        ?.targetingAttributeColumns ?? [];

    const banditConversionWindowValue =
      shouldIncludeConversionWindow && data.banditConversionWindowValue
        ? Number(data.banditConversionWindowValue)
        : undefined;
    const banditConversionWindowUnit =
      shouldIncludeConversionWindow && data.banditConversionWindowUnit
        ? data.banditConversionWindowUnit
        : undefined;

    const createBody: ApiCreateContextualBanditBody = {
      name: data.name ?? "",
      description: data.description,
      project: data.project || undefined,
      owner: data.owner || undefined,
      tags: data.tags ?? [],

      trackingKey: data.trackingKey ?? "",
      hashAttribute: data.hashAttribute || undefined,

      variations: (data.variations ?? []).map((v, i) => ({
        key: v.key || `${i}`,
        name: v.name ?? "",
        description: v.description,
      })),

      datasource: data.datasource ?? "",
      contextualBanditQueryId: data.exposureQueryId ?? "",
      decisionMetric: data.decisionMetric ?? "",

      scheduleValue: data.banditScheduleValue,
      scheduleUnit: data.banditScheduleUnit,
      burnInValue: data.banditBurnInValue,
      burnInUnit: data.banditBurnInUnit,
      conversionWindowValue: banditConversionWindowValue,
      conversionWindowUnit: banditConversionWindowUnit,

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
      numMetrics: createBody.decisionMetric ? 1 : 0,
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

  const status = form.watch("status");

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
        showHeaderCloseButton={false}
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
                You are creating an experiment in the Sample Data Project. When
                the sample data is deleted, this experiment is kept and moved to
                All Projects.
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
              label="Name"
              required
              minLength={2}
              {...nameFieldHandlers}
              onChange={async (e) => {
                nameFieldHandlers.onChange(e);

                if (!isNewExperiment) return;
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

            <Separator size="4" my="5" />
            {(isNewExperiment || duplicate) && (
              <>
                <ContextualBanditAssignmentAttributeSelect project={project} />

                <FeatureVariationsInput
                  simple={true}
                  hideCoverage={true}
                  label={null}
                  valueType="string"
                  coverageLabel="Traffic included in this Bandit"
                  coverageTooltip="Users not included in the Bandit will skip this experiment"
                  coverage={form.watch("coverage") ?? 1}
                  setCoverage={(coverage) =>
                    form.setValue("coverage", coverage)
                  }
                  setWeight={setVariationWeight}
                  variations={variationsForInput}
                  setVariations={setCombinedVariations}
                />
              </>
            )}

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
                    date={form.watch("dateStarted")}
                    setDate={(v) => {
                      form.setValue("dateStarted", v ? datetime(v) : "");
                    }}
                    scheduleEndDate={form.watch("dateEnded")}
                    disableAfter={form.watch("dateEnded") || undefined}
                  />
                )}
                {status === "stopped" && (
                  <DatePicker
                    label="End Time (UTC)"
                    date={form.watch("dateEnded")}
                    setDate={(v) => {
                      form.setValue("dateEnded", v ? datetime(v) : "");
                    }}
                    scheduleStartDate={form.watch("dateStarted")}
                    disableBefore={form.watch("dateStarted") || undefined}
                  />
                )}
              </>
            )}
          </div>
        </Page>

        {(isNewExperiment || duplicate) && (
          <Page display="Data">
            <div className="px-2">
              <ContextualBanditAnalysisFields
                project={project}
                disableBanditConversionWindow={disableBanditConversionWindow}
                setDisableBanditConversionWindow={
                  setDisableBanditConversionWindow
                }
              />
            </div>
          </Page>
        )}
      </PagedModal>
    </FormProvider>
  );
};

export default ContextualBanditForm;
