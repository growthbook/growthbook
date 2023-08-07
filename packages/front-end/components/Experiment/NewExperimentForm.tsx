import { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentStatus,
  Variation,
} from "back-end/types/experiment";
import { useRouter } from "next/router";
import { getValidDate } from "shared/dates";
import { useWatching } from "@/services/WatchProvider";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import { getEqualWeights } from "@/services/utils";
import { generateVariationId, useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import MarkdownInput from "../Markdown/MarkdownInput";
import TagsInput from "../Tags/TagsInput";
import Page from "../Modal/Page";
import PagedModal from "../Modal/PagedModal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import MetricsSelector from "./MetricsSelector";

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

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialValue?.project || project || "",
      trackingKey: initialValue?.trackingKey || "",
      datasource:
        initialValue?.datasource || settings.defaultDataSource
          ? settings.defaultDataSource
          : datasources?.[0]?.id || "",
      exposureQueryId:
        getExposureQuery(
          initialValue?.datasource
            ? getDatasourceById(initialValue.datasource)?.settings
            : undefined,
          initialValue?.exposureQueryId,
          initialValue?.userIdType
        )?.id || "",
      name: initialValue?.name || "",
      hypothesis: initialValue?.hypothesis || "",
      activationMetric: initialValue?.activationMetric || "",
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

    const body = JSON.stringify(data);

    const res = await apiCall<
      | { experiment: ExperimentInterfaceStringDates }
      | { duplicateTrackingKey: true; existingId: string }
    >(
      `/experiments${
        allowDuplicateTrackingKey ? "?allowDuplicateTrackingKey=true" : ""
      }`,
      {
        method: "POST",
        body,
      }
    );

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
  const status = form.watch("status");

  return (
    <PagedModal
      header={isNewExperiment ? "New Experiment" : "New Experiment Analysis"}
      close={onClose}
      docSection="experiments"
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
      <Page display={isNewExperiment ? "Targeting and Goals" : "Goals"}>
        {isNewExperiment && (
          <div className="alert alert-info">
            You will have a chance to review and change these settings before
            starting your experiment.
          </div>
        )}
        <div style={{ minHeight: 350 }}>
          {isNewExperiment && (
            <ConditionInput
              defaultValue={""}
              labelClassName="font-weight-bold"
              onChange={(value) => form.setValue("phases.0.condition", value)}
            />
          )}
          {(!isImport || fromFeature) && (
            <SelectField
              label="Data Source"
              labelClassName="font-weight-bold"
              value={form.watch("datasource") ?? ""}
              onChange={(v) => form.setValue("datasource", v)}
              initialOption="Manual"
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
            />
          )}
          <div className="form-group">
            <label className="font-weight-bold mb-1">Goal Metrics</label>
            <div className="mb-1 font-italic">
              Metrics you are trying to improve with this experiment.
            </div>
            <MetricsSelector
              selected={form.watch("metrics") ?? []}
              onChange={(metrics) => form.setValue("metrics", metrics)}
              datasource={datasource?.id}
            />
          </div>
          <div className="form-group">
            <label className="font-weight-bold mb-1">Guardrail Metrics</label>
            <div className="mb-1 font-italic">
              Metrics you want to monitor, but are NOT specifically trying to
              improve.
            </div>
            <MetricsSelector
              selected={form.watch("guardrails") ?? []}
              onChange={(metrics) => form.setValue("guardrails", metrics)}
              datasource={datasource?.id}
            />
          </div>
        </div>
      </Page>
    </PagedModal>
  );
};

export default NewExperimentForm;
