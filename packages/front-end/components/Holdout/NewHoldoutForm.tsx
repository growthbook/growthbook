import React, { FC, useEffect, useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useRouter } from "next/router";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { OrganizationSettings } from "shared/types/organization";
import {
  isProjectListValidForProject,
  validateAndFixCondition,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { generateTrackingKey } from "shared/experiments";
import { kebabCase } from "lodash";
import { Tooltip, Text } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiArrowSquareOutFill, PiCaretRightFill } from "react-icons/pi";
import { FeatureEnvironment } from "shared/types/feature";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import { useAttributeSchema, useEnvironments } from "@/services/features";
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
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "@/components/Features/SavedGroupTargetingField";
import { useExperiments } from "@/hooks/useExperiments";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import variationInputStyles from "@/components/Features/VariationsInput.module.scss";
import useSDKConnections from "@/hooks/useSDKConnections";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";
import MultiSelectField from "@/components/Forms/MultiSelectField";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type NewHoldoutFormProps = {
  initialStep?: number;
  initialHoldout?: Partial<HoldoutInterfaceStringDates>;
  initialExperiment?: Partial<ExperimentInterfaceStringDates>;
  includeDescription?: boolean;
  duplicate?: boolean;
  source: string;
  msg?: string;
  onClose?: () => void;
  onCreate?: (id: string) => void;
  inline?: boolean;
  isNewHoldout?: boolean;
  mutate?: () => void;
};

export function getNewExperimentDatasourceDefaults(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
  initialValue?: Partial<ExperimentInterfaceStringDates>,
): Pick<ExperimentInterfaceStringDates, "datasource" | "exposureQueryId"> {
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

  return {
    datasource: initialDatasource.id,
    exposureQueryId:
      getExposureQuery(
        initialDatasource.settings,
        initialValue?.exposureQueryId,
        initialValue?.userIdType,
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
    // How should we handle a holdout having multiple projects here?
    const canPublish = permissions.canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = canPublish ? defaultEnabled : false;
    const rules = [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const NewHoldoutForm: FC<NewHoldoutFormProps> = ({
  initialStep = 0,
  initialHoldout,
  initialExperiment = {
    type: "holdout",
  },
  onClose,
  onCreate = null,
  includeDescription = true,
  duplicate,
  source,
  msg,
  inline,
  isNewHoldout,
  mutate,
}) => {
  const { organization } = useUser();

  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);

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

  const settings = useOrgSettings();
  const { statsEngine: orgStatsEngine } = useOrgSettings();
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    experiment: (initialExperiment ?? undefined) as
      | ExperimentInterfaceStringDates
      | undefined,
  });
  const permissionsUtils = usePermissionsUtil();

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project,
  }).includes("prerequisites");
  const hasSDKWithNoPrerequisites = !getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    mustMatchAllConnections: true,
    project,
  }).includes("prerequisites");
  const hasSDKWithRemoteEval = (sdkConnectionsData?.connections || []).some(
    (c) => c.remoteEvalEnabled,
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

  const form = useForm<
    Partial<
      Omit<
        ExperimentInterfaceStringDates,
        "id" | "linkedFeatures" | "linkedExperiments"
      > &
        HoldoutInterfaceStringDates
    >
  >({
    defaultValues: {
      projects: initialHoldout?.projects || [],
      name: initialHoldout?.name || "",
      ...getNewExperimentDatasourceDefaults(
        datasources,
        settings,
        initialExperiment?.project || project || "",
        initialExperiment,
      ),
      hashAttribute: initialExperiment?.hashAttribute || hashAttribute,
      goalMetrics: initialExperiment?.goalMetrics || [],
      secondaryMetrics: initialExperiment?.secondaryMetrics || [],
      tags: initialExperiment?.tags || [],
      description: initialExperiment?.description || "",
      phases: [
        {
          coverage: initialExperiment?.phases?.[0]?.coverage || 0.1,
          dateStarted: new Date().toISOString().substr(0, 16),
          dateEnded: new Date().toISOString().substr(0, 16),
          name: "Holdout",
          reason: "",
          variationWeights: [0.5, 0.5],
          savedGroups: initialExperiment?.phases?.[0]?.savedGroups || [],
          condition: initialExperiment?.phases?.[0]?.condition || "",
        },
      ],
      status: "draft",
      regressionAdjustmentEnabled:
        scopedSettings.regressionAdjustmentEnabled.value,
      environmentSettings:
        initialHoldout?.environmentSettings ||
        genEnvironmentSettings({
          environments,
          permissions: permissionsUtils,
          project,
        }),
    },
  });

  // TODO: add custom fields back in when we have a way to filter them by multiple projects
  // const customFields = filterCustomFieldsForSectionAndProject(
  //   useCustomFields(),
  //   "experiment",
  //   selectedProject
  // );

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
    }

    const body = JSON.stringify(data);

    const res = await apiCall<{
      experiment: ExperimentInterfaceStringDates;
      holdout: HoldoutInterfaceStringDates;
    }>("/holdout", {
      method: "POST",
      body,
    });
    mutate?.();

    // TODO remove if data correlates
    track("Create Holdout", {
      source,
      numTags: data.tags?.length || 0,
      numMetrics:
        (data.goalMetrics?.length || 0) + (data.secondaryMetrics?.length || 0),
    });

    data.tags && refreshTags(data.tags);
    if (onCreate) {
      onCreate(res.holdout.id);
    } else if (res.holdout) {
      router.push(`/holdout/${res.holdout.id}`);
    }
  });

  const availableProjects: (SingleValue | GroupedValue)[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .filter((p) => permissionsUtils.canViewHoldoutModal([p.id]))
    .map((p) => ({ value: p.id, label: p.name }));

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

  let header = "Add new Holdout";
  if (duplicate) {
    header = "Duplicate Holdout";
  }
  const trackingEventModalType = kebabCase(header);

  const nameFieldHandlers = form.register("name", {
    setValueAs: (s) => s?.trim(),
  });

  const environmentSettings = form.watch("environmentSettings") || {};

  const prerequisiteAlert = hasSDKWithNoPrerequisites ? (
    <Callout status={hasSDKWithPrerequisites ? "warning" : "error"} mb="4">
      {hasSDKWithPrerequisites
        ? "Some of your SDK Connections in this project may not support Prerequisite evaluation, which is mandatory for Holdouts."
        : "None of your SDK Connections in this project support Prerequisite evaluation, which is mandatory for Holdouts. Either upgrade your SDKs or add a supported SDK."}
      <Link
        href={"/sdks"}
        weight="bold"
        className="pl-2"
        rel="noreferrer"
        target="_blank"
      >
        View SDKs
        <PiArrowSquareOutFill className="ml-1" />
      </Link>
    </Callout>
  ) : null;

  const remoteEvalAlert = hasSDKWithRemoteEval ? (
    <Callout status="info" mb="4">
      When using a Remote Evaluated SDK Connection with Holdouts, you must use a
      compatible version of <strong>GrowthBook Proxy</strong> (1.2.8+) or the{" "}
      <strong>remote evaluation library</strong> (1.1.0+).
    </Callout>
  ) : null;

  return (
    <FormProvider {...form}>
      <PagedModal
        trackingEventModalType={trackingEventModalType}
        trackingEventModalSource={source}
        header={header}
        close={onClose}
        docSection="holdouts"
        submit={onSubmit}
        cta="Save"
        ctaEnabled={hasSDKWithPrerequisites}
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

            {prerequisiteAlert}
            {remoteEvalAlert}

            <Field
              label={"Holdout Name"}
              required
              minLength={2}
              {...nameFieldHandlers}
              onChange={async (e) => {
                // Ensure the name field is updated and then sync with trackingKey if possible
                nameFieldHandlers.onChange(e);

                if (!isNewHoldout) return;
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
            {projects?.length > 0 && (
              <div className="form-group">
                <MultiSelectField
                  label={
                    <>
                      Projects{" "}
                      <Tooltip
                        content={
                          "The dropdown below has been filtered to only include projects where you have permission to create Holdouts."
                        }
                      />
                    </>
                  }
                  placeholder="All projects"
                  value={form.watch("projects") || []}
                  options={availableProjects}
                  onChange={(v) => form.setValue("projects", v)}
                  customClassName="label-overflow-ellipsis"
                  helpText="Assign this holdout to specific projects"
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
            {/* {hasCommercialFeature("custom-metadata") && !!customFields?.length && (
              <CustomFieldInput
                customFields={customFields}
                currentCustomFields={form.watch("customFields") || {}}
                setCustomFields={(value) => {
                  form.setValue("customFields", value);
                }}
                section={"experiment"}
                project={selectedProject}
              />
            )} */}
          </div>
        </Page>

        <Page display="Traffic">
          <div className="px-2">
            {prerequisiteAlert}

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
            </div>

            <div>
              <Text as="label" size="2" weight="medium">
                Holdout Size
                <Text size="1" as="div" weight="regular" color="gray">
                  Enter the percent of traffic that you would like to be in the
                  holdout. The same amount of traffic will be in the control.
                </Text>
              </Text>
              <div
                className={`position-relative ${variationInputStyles.percentInputWrap} ${variationInputStyles.hideArrows}`}
                style={{ width: 110 }}
              >
                <Field
                  style={{ width: 95 }}
                  value={
                    isNaN(form.watch("phases.0.coverage") ?? 0)
                      ? ""
                      : decimalToPercent(
                          (form.watch("phases.0.coverage") ?? 0) / 2,
                        )
                  }
                  onChange={(e) => {
                    let decimal = percentToDecimal(e.target.value);
                    if (decimal > 1) decimal = 1;
                    if (decimal < 0) decimal = 0;
                    form.setValue("phases.0.coverage", decimal * 2);
                  }}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                />
                <span>%</span>
              </div>
            </div>
          </div>
        </Page>

        <Page display="Targeting">
          <div>
            {prerequisiteAlert}

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
          </div>
        </Page>

        <Page display="Metrics">
          <div className="px-2">
            {prerequisiteAlert}

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
              goalMetricsDescription="The primary metrics you are trying to improve within this holdout. "
              filterConversionWindowMetrics={true}
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
                <StatsEngineSelect
                  className="mb-4"
                  label={<div>Statistics Engine</div>}
                  value={form.watch("statsEngine") ?? orgStatsEngine}
                  onChange={(v) => form.setValue("statsEngine", v)}
                  allowUndefined={false}
                />
              </div>
            </Collapsible>
          </div>
        </Page>
      </PagedModal>
    </FormProvider>
  );
};

export default NewHoldoutForm;
