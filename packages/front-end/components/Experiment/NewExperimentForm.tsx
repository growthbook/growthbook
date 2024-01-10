import React, { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import { getEqualWeights } from "@/services/utils";
import { generateVariationId, useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import useIncrementer from "@/hooks/useIncrementer";
import MarkdownInput from "../Markdown/MarkdownInput";
import TagsInput from "../Tags/TagsInput";
import Page from "../Modal/Page";
import PagedModal from "../Modal/PagedModal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SavedGroupTargetingField, {
  validateSavedGroupTargeting,
} from "../Features/SavedGroupTargetingField";
import Tooltip from "../Tooltip/Tooltip";
import MetricsSelector, { MetricsSelectorTooltipBody } from "./MetricsSelector";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type NewExperimentFormProps = {
  initialStep?: number;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialNumVariations?: number;
  isImport?: boolean;
  fromFeature?: boolean;
  includeDescription?: boolean;
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
  initialValue,
  initialNumVariations = 2,
  onClose,
  onCreate = null,
  isImport,
  fromFeature,
  includeDescription,
  source,
  idea,
  msg,
  inline,
  isNewExperiment,
}) => {
  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);
  const [allowDuplicateTrackingKey, setAllowDuplicateTrackingKey] = useState(
    false
  );

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
  } = useDefinitions();

  const settings = useOrgSettings();

  const { refreshWatching } = useWatching();

  useEffect(() => {
    track("New Experiment Form", {
      source,
    });
  }, []);

  const [conditionKey, forceConditionRender] = useIncrementer();

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

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
      hashVersion: initialValue?.hashVersion || 2,
      attributionModel:
        initialValue?.attributionModel ??
        settings?.attributionModel ??
        "firstExposure",
      metrics: initialValue?.metrics || [],
      tags: initialValue?.tags || [],
      targetURLRegex: initialValue?.targetURLRegex || "",
      description: initialValue?.description || "",
      guardrails: initialValue?.guardrails || [],
      variations: initialValue?.variations
        ? initialValue.variations
        : getDefaultVariations(initialNumVariations),
      phases: [
        initialValue
          ? {
              coverage: initialValue.phases?.[0].coverage || 1,
              dateStarted: getValidDate(
                initialValue.phases?.[0]?.dateStarted ?? ""
              )
                .toISOString()
                .substr(0, 16),
              dateEnded: getValidDate(initialValue.phases?.[0]?.dateEnded ?? "")
                .toISOString()
                .substr(0, 16),
              name: initialValue.phases?.[0].name || "Main",
              reason: "",
              variationWeights:
                initialValue.phases?.[0].variationWeights ||
                getEqualWeights(
                  initialValue.variations ? initialValue.variations.length : 2
                ),
            }
          : {
              coverage: 1,
              dateStarted: new Date().toISOString().substr(0, 16),
              dateEnded: new Date().toISOString().substr(0, 16),
              name: "Main",
              reason: "",
              variationWeights: [0.5, 0.5],
            },
      ],
      status: !isImport ? "draft" : initialValue?.status || "running",
      ideaSource: idea || "",
    },
  });

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;
  const supportsSQL = datasource?.properties?.queryLanguage === "sql";

  const { apiCall } = useAuth();

  const onSubmit = form.handleSubmit(async (value) => {
    // Make sure there's an experiment name
    if ((value.name?.length ?? 0) < 1) {
      setStep(0);
      throw new Error("Experiment Name must not be empty");
    }

    // TODO: more validation?
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {};
    if (allowDuplicateTrackingKey) {
      params.allowDuplicateTrackingKey = true;
    }
    if (source === "duplicate" && initialValue?.id) {
      params.originalId = initialValue.id;
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
        "Warning: An experiment with that id already exists. To continue anyway, click 'Save' again."
      );
    }

    track("Create Experiment", {
      source,
      numTags: data.tags?.length || 0,
      numMetrics: data.metrics?.length || 0,
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
  const userIdType = exposureQueries.find(
    (e) => e.id === form.getValues("exposureQueryId")
  )?.userIdType;
  const status = form.watch("status");

  const { currentProjectIsDemo } = useDemoDataSourceProject();

  let header = isNewExperiment ? "New Experiment" : "New Experiment Analysis";
  if (source === "duplicate") {
    header = "Duplicate Experiment";
  }

  return (
    <PagedModal
      header={header}
      close={onClose}
      docSection="experimentConfiguration"
      submit={onSubmit}
      cta={"Save"}
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
      inline={inline}
    >
      <Page display="Basic Info">
        {msg && <div className="alert alert-info">{msg}</div>}

        {currentProjectIsDemo && (
          <div className="alert alert-warning">
            You are creating an experiment under the demo datasource project.
            This experiment will be deleted when the demo datasource project is
            deleted.
          </div>
        )}

        <Field label="Name" required minLength={2} {...form.register("name")} />
        {!isImport && !fromFeature && datasource && !isNewExperiment && (
          <Field
            label="Experiment Id"
            {...form.register("trackingKey")}
            helpText={
              supportsSQL ? (
                <>
                  Must match the <code>experiment_id</code> field in your
                  database table
                </>
              ) : (
                "Must match the experiment id in your tracking callback"
              )
            }
          />
        )}

        <div className="form-group">
          <label>Tags</label>
          <TagsInput
            value={form.watch("tags") ?? []}
            onChange={(tags) => form.setValue("tags", tags)}
          />
        </div>
        <Field
          label="Hypothesis"
          textarea
          minRows={2}
          maxRows={6}
          placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          {...form.register("hypothesis")}
        />
        {includeDescription && (
          <div className="form-group">
            <label>Description</label>
            <MarkdownInput
              value={form.watch("description") ?? ""}
              setValue={(val) => form.setValue("description", val)}
            />
          </div>
        )}
        {!isNewExperiment && (
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
          />
        )}
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
      </Page>
      <Page display="Variation Assignment">
        {isNewExperiment && (
          <div className="alert alert-info">
            You will have a chance to review and change these settings before
            starting your experiment.
          </div>
        )}
        {isNewExperiment && (
          <SavedGroupTargetingField
            value={form.watch("phases.0.savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("phases.0.savedGroups", savedGroups)
            }
          />
        )}
        {isNewExperiment && (
          <ConditionInput
            defaultValue={form.watch("phases.0.condition") || ""}
            onChange={(value) => form.setValue("phases.0.condition", value)}
            key={conditionKey}
          />
        )}
        {isNewExperiment && (
          <SelectField
            label="Assign variation based on attribute"
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => ({ label: s.property, value: s.property }))}
            value={form.watch("hashAttribute") ?? ""}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            helpText={
              "Will be hashed and used to assign a variation to each user that views the experiment"
            }
          />
        )}
        <FeatureVariationsInput
          valueType={"string"}
          coverage={form.watch("phases.0.coverage")}
          setCoverage={(coverage) =>
            form.setValue("phases.0.coverage", coverage)
          }
          setWeight={(i, weight) =>
            form.setValue(`phases.0.variationWeights.${i}`, weight)
          }
          valueAsId={true}
          setVariations={(v) => {
            form.setValue(
              "variations",
              v.map((data, i) => {
                return {
                  // default values
                  name: "",
                  screenshots: [],
                  // overwrite defaults
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
          coverageTooltip={
            isNewExperiment
              ? "This can be changed later"
              : "This is just for documentation purposes and has no effect on the analysis."
          }
          showPreview={!!isNewExperiment}
        />
        {isNewExperiment && (
          <NamespaceSelector
            formPrefix="phases.0."
            form={form}
            featureId={""}
            trackingKey={""}
          />
        )}
      </Page>
      {!isNewExperiment && (
        <Page display={"Analysis Settings"}>
          <div style={{ minHeight: 350 }}>
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
                label="Experiment Assignment Table"
                labelClassName="font-weight-bold"
                value={form.watch("exposureQueryId") ?? ""}
                onChange={(v) => form.setValue("exposureQueryId", v)}
                initialOption="Choose..."
                required
                options={exposureQueries.map((q) => {
                  return {
                    label: q.name,
                    value: q.id,
                  };
                })}
                helpText={
                  <>
                    <div>
                      Should correspond to the Identifier Type used to randomize
                      units for this experiment
                    </div>
                    {userIdType ? (
                      <>
                        Identifier Type: <code>{userIdType}</code>
                      </>
                    ) : null}
                  </>
                }
              />
            )}
            <div className="form-group">
              <div className="mb-1">
                <span className="font-italic">
                  Metrics you are trying to improve with this experiment.{" "}
                </span>
                <Tooltip body={MetricsSelectorTooltipBody()} />
              </div>
              <MetricsSelector
                selected={form.watch("metrics") ?? []}
                onChange={(metrics) => form.setValue("metrics", metrics)}
                datasource={datasource?.id}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
              />
            </div>
            <div className="form-group">
              <label className="font-weight-bold mb-1">Guardrail Metrics</label>
              <div className="mb-1">
                <span className="font-italic">
                  Metrics you want to monitor, but are NOT specifically trying
                  to improve.{" "}
                </span>
                <Tooltip body={MetricsSelectorTooltipBody()} />
              </div>
              <MetricsSelector
                selected={form.watch("guardrails") ?? []}
                onChange={(metrics) => form.setValue("guardrails", metrics)}
                datasource={datasource?.id}
                exposureQueryId={exposureQueryId}
                project={project}
                includeFacts={true}
              />
            </div>
          </div>
        </Page>
      )}
    </PagedModal>
  );
};

export default NewExperimentForm;
