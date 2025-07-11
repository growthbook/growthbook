import React, { FC, useEffect, useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import { useRouter } from "next/router";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { OrganizationSettings } from "back-end/types/organization";
import {
  isProjectListValidForProject,
  validateAndFixCondition,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { generateTrackingKey } from "shared/experiments";
import { kebabCase } from "lodash";
import { Box, TextField, Tooltip, Text } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
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
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useIncrementer } from "@/hooks/useIncrementer";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import { useUser } from "@/services/UserContext";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import useSDKConnections from "@/hooks/useSDKConnections";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import TagsInput from "@/components/Tags/TagsInput";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import Field from "@/components/Forms/Field";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import { useExperiments } from "@/hooks/useExperiments";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import ExperimentMetricsSelector from "../Experiment/ExperimentMetricsSelector";
import MetricSelector from "../Experiment/MetricSelector";
import { MetricsSelectorTooltip } from "../Experiment/MetricsSelector";
import StatsEngineSelect from "../Settings/forms/StatsEngineSelect";
import EnvironmentSelect from "../Features/FeatureModal/EnvironmentSelect";
import { FeatureEnvironment } from "back-end/types/feature";

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
  mutate?: () => void;
};

export function getDefaultVariations(num: number) {
  // Must have at least 2 variations
  num = Math.max(2, num);

  const variations: Variation[] = [];
  for (let i = 0; i < num; i++) {
    variations.push({
      name: i ? "Holdout" : "Control",
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

export const genEnvironmentSettings = ({
  environments,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissionsUtil>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? e.defaultState ?? true : false;
    const enabled = canPublish ? defaultEnabled : false;
    const rules = [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const NewHoldoutForm: FC<NewExperimentFormProps> = ({
  initialStep = 0,
  initialValue = {
    type: "holdout",
  },
  onClose,
  onCreate = null,
  includeDescription = true,
  duplicate,
  source,
  msg,
  inline,
  isNewExperiment,
  mutate,
}) => {
  const { organization, hasCommercialFeature } = useUser();

  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);
  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );

  const {
    datasources,
    getDatasourceById,
    getExperimentMetricById,
    refreshTags,
    project,
    projects,
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
  const { statsEngine: orgStatsEngine } = useOrgSettings();
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
      variations: getDefaultVariations(2),
      tags: initialValue?.tags || [],
      targetURLRegex: initialValue?.targetURLRegex || "",
      description: initialValue?.description || "",
      phases: [
        {
          coverage: 0.1,
          dateStarted: new Date().toISOString().substr(0, 16),
          dateEnded: new Date().toISOString().substr(0, 16),
          name: "Main",
          reason: "",
          variationWeights: [0.5, 0.5],
        },
      ],
      status: "draft",
      customFields: initialValue?.customFields,
      regressionAdjustmentEnabled:
        scopedSettings.regressionAdjustmentEnabled.value,
    },
  });

  const [selectedProject, setSelectedProject] = useState(form.watch("project"));
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    selectedProject
  );

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

    params.isHoldout = true;

    const res = await apiCall<
      | { experiment: ExperimentInterfaceStringDates; holdoutId?: string }
      | { duplicateTrackingKey: true; existingId: string; isHoldout: true }
    >(`/experiments?${new URLSearchParams(params).toString()}`, {
      method: "POST",
      body,
    });
    mutate?.();

    if ("duplicateTrackingKey" in res) {
      setAllowDuplicateTrackingKey(true);
      throw new Error(
        "Warning: An experiment with that tracking key already exists. To continue anyway, click 'Save' again."
      );
    }

    // TODO remove if data correlates
    track("Create Holdout", {
      source,
      numTags: data.tags?.length || 0,
      numMetrics:
        (data.goalMetrics?.length || 0) + (data.secondaryMetrics?.length || 0),
    });
    refreshWatching();

    data.tags && refreshTags(data.tags);
    if (onCreate) {
      onCreate(res.experiment.id);
    } else if (res.holdoutId) {
      router.push(`/holdout/${res.holdoutId}`);
    }
  });

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtils.canViewExperimentModal(p.id))
    .map((p) => ({ value: p.id, label: p.name }));

  const allowAllProjects = permissionsUtils.canViewExperimentModal();

  const exposureQueries = useMemo(() => {
    return datasource?.settings?.queries?.exposure || [];
  }, [datasource]);
  const exposureQueryId = form.getValues("exposureQueryId");

  const { currentProjectIsDemo } = useDemoDataSourceProject();

  useEffect(() => {
    if (!exposureQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", exposureQueries?.[0]?.id ?? "");
    }
  }, [form, exposureQueries, exposureQueryId]);

  const [linkNameWithTrackingKey, _setLinkNameWithTrackingKey] = useState(true);

  let header = isNewExperiment
    ? "Add new Holdout"
    : "Add new Experiment Analysis";
  if (duplicate) {
    header = "Duplicate Holdout";
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });

  const environmentSettings = genEnvironmentSettings({
    environments,
    permissions: permissionsUtils,
    project,
  });

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
                You are creating a holdout under the demo datasource project.
                This experiment will be deleted when the demo datasource project
                is deleted.
              </div>
            )}
            <Field
              label={"Holdout Name"}
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

            {projects.length >= 1 && (
              <div className="form-group">
                <label>Project</label>
                <SelectField
                  value={form.watch("project") ?? ""}
                  onChange={(p) => {
                    form.setValue("project", p);
                    setSelectedProject(p);
                  }}
                  name="project"
                  initialOption={allowAllProjects ? "All Projects" : undefined}
                  options={availableProjects}
                />
              </div>
            )}

            {includeDescription && (
              <Field
                label="Description"
                textarea
                minRows={1}
                {...form.register("description")}
                placeholder={"Short human-readable description of the Holdout"}
              />
            )}
            <div className="form-group">
              <label>Tags</label>
              <TagsInput
                value={form.watch("tags") ?? []}
                onChange={(tags) => form.setValue("tags", tags)}
              />
            </div>
            <EnvironmentSelect
              environmentSettings={environmentSettings}
              environments={environments}
              setValue={(env, on) => {
                environmentSettings[env.id].enabled = on;
                form.setValue("environmentSettings", environmentSettings);
              }}
            />
            {hasCommercialFeature("custom-metadata") && !!customFields?.length && (
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
        <Page display="Traffic">
          <div className="mb-4">
            <SelectField
              label="Assign Variation by Attribute"
              containerClassName="flex-1"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({ label: s.property, value: s.property }))}
              value={form.watch("hashAttribute") ?? ""}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              helpText={
                "Will be hashed together with the Tracking Key to determine which variation to assign"
              }
            />
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
            />
          </div>

          <div>
            <Text as="label" size="2" weight="medium">
              Holdout Size
              <Text size="1" as="div" weight="regular" color="gray">
                Enter the percent of traffic that you would like to be in the
                holdout. The same amount of traffic will be in the control.
              </Text>
            </Text>
            <Box maxWidth="100px">
              <TextField.Root
                placeholder=""
                type="number"
                required
                value={decimalToPercent(form.watch("phases.0.coverage") / 2)}
                onChange={(e) => {
                  form.setValue(
                    "phases.0.coverage",
                    percentToDecimal(e.target.value) * 2
                  );
                }}
              >
                <TextField.Slot></TextField.Slot>
                <TextField.Slot>%</TextField.Slot>
              </TextField.Root>
            </Box>
          </div>
        </Page>

        <Page display="Targeting">
          <SavedGroupTargetingField
            value={form.watch("phases.0.savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("phases.0.savedGroups", savedGroups)
            }
            project={project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("phases.0.condition") || ""}
            onChange={(value) => form.setValue("phases.0.condition", value)}
            key={conditionKey}
            project={project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={form.watch("phases.0.prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("phases.0.prerequisites", prerequisites)
            }
            environments={envs}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
        </Page>
        <Page display="Metrics">
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <SelectField
              label="Data Source"
              labelClassName="font-weight-bold"
              value={form.watch("datasource") ?? ""}
              onChange={(newDatasource) => {
                form.setValue("datasource", newDatasource);

                // If unsetting the datasource, leave all the other settings alone
                // That way, it will be restored if the user switches back to the previous value
                if (!newDatasource) return;

                const isValidMetric = (id: string) =>
                  getExperimentMetricById(id)?.datasource === newDatasource;

                // If the activationMetric is now invalid
                const activationMetric = form.watch("activationMetric");
                if (activationMetric && !isValidMetric(activationMetric)) {
                  form.setValue("activationMetric", "");
                }
              }}
              options={datasources.map((d) => {
                const isDefaultDataSource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  }${isDefaultDataSource ? " (default)" : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
            />

            {datasource?.properties?.exposureQueries && exposureQueries ? (
              <SelectField
                label={
                  <>
                    Experiment Assignment Table{" "}
                    <Tooltip content="Should correspond to the Identifier Type used to randomize units for this experiment" />
                  </>
                }
                labelClassName="font-weight-bold"
                value={form.watch("exposureQueryId") ?? ""}
                onChange={(v) => form.setValue("exposureQueryId", v)}
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
            ) : null}
          </div>

          <ExperimentMetricsSelector
            datasource={datasource?.id}
            exposureQueryId={exposureQueryId}
            project={project}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={[]}
            setGoalMetrics={(goalMetrics) =>
              form.setValue("goalMetrics", goalMetrics)
            }
            setSecondaryMetrics={(secondaryMetrics) =>
              form.setValue("secondaryMetrics", secondaryMetrics)
            }
            collapseSecondary={true}
          />

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
              {!!datasource && (
                <MetricSelector
                  datasource={form.watch("datasource")}
                  exposureQueryId={exposureQueryId}
                  project={project}
                  includeFacts={true}
                  labelClassName="font-weight-bold"
                  label={
                    <>
                      Activation Metric{" "}
                      <MetricsSelectorTooltip onlyBinomial={true} />
                    </>
                  }
                  initialOption="None"
                  onlyBinomial
                  value={form.watch("activationMetric") || ""}
                  onChange={(value) =>
                    form.setValue("activationMetric", value || "")
                  }
                  helpText="Users must convert on this metric before being included"
                />
              )}
              {/* 
              {datasource?.properties?.separateExperimentResultQueries && (
                <SelectField
                  label="Metric Conversion Windows"
                  labelClassName="font-weight-bold"
                  value={form.watch("skipPartialData")}
                  onChange={(value) => form.setValue("skipPartialData", value)}
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
                  helpText="For users not enrolled in the experiment long enough to complete conversion window"
                />
              )} */}
              <StatsEngineSelect
                className="mb-4"
                label={<div>Statistics Engine</div>}
                value={form.watch("statsEngine") ?? orgStatsEngine}
                onChange={(v) => form.setValue("statsEngine", v)}
                allowUndefined={false}
              />
            </div>
          </Collapsible>
        </Page>
      </PagedModal>
    </FormProvider>
  );
};

export default NewHoldoutForm;
