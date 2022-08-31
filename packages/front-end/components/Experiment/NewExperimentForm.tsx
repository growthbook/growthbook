import { FC, useEffect, useState } from "react";
import { useAuth } from "../../services/auth";
import { useForm } from "react-hook-form";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import TagsInput from "../Tags/TagsInput";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import MetricsSelector from "./MetricsSelector";
import { useWatching } from "../../services/WatchProvider";
import MarkdownInput from "../Markdown/MarkdownInput";
import { useRouter } from "next/router";
import track from "../../services/track";
import { useDefinitions } from "../../services/DefinitionsContext";
import useUser from "../../hooks/useUser";
import Field from "../Forms/Field";
import { getValidDate } from "../../services/dates";
import SelectField from "../Forms/SelectField";
import { getExposureQuery } from "../../services/datasources";
import VariationsInput from "../Features/VariationsInput";
import VariationDataInput from "./VariationDataInput";

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
  onClose: () => void;
  onCreate?: (id: string) => void;
};

function getEvenSplit(n: number) {
  const weights = [];
  const equal = 100 / n;

  for (let i = 0; i < n; i++) {
    weights.push((i > 0 ? Math.floor(equal) : Math.ceil(equal)) / 100);
  }

  return weights;
}

function getDefaultVariations(num: number) {
  // Must have at least 2 variations
  num = Math.max(2, num);

  const variations: Variation[] = [];
  for (let i = 0; i < num; i++) {
    variations.push({
      name: i ? `Variation ${i}` : "Control",
      description: "",
      key: "",
      screenshots: [],
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
}) => {
  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
  } = useDefinitions();
  const { refreshWatching } = useWatching();

  useEffect(() => {
    track("New Experiment Form", {
      source,
    });
  }, []);

  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      project: initialValue?.project || project || "",
      implementation: initialValue?.implementation || "code",
      trackingKey: initialValue?.trackingKey || "",
      datasource: initialValue?.datasource || datasources?.[0]?.id || "",
      exposureQueryId:
        getExposureQuery(
          getDatasourceById(initialValue?.datasource)?.settings,
          initialValue?.exposureQueryId,
          initialValue?.userIdType
        )?.id || "",
      name: initialValue?.name || "",
      hypothesis: initialValue?.hypothesis || "",
      activationMetric: initialValue?.activationMetric || "",
      removeMultipleExposures: initialValue?.removeMultipleExposures ?? true,
      metrics: initialValue?.metrics || [],
      tags: initialValue?.tags || [],
      targetURLRegex: initialValue?.targetURLRegex || "",
      description: initialValue?.description || "",
      guardrails: initialValue?.guardrails || [],
      variations:
        initialValue?.variations || getDefaultVariations(initialNumVariations),
      phases: [
        initialValue
          ? {
              coverage: initialValue.phases?.[0].coverage || 1,
              dateStarted: getValidDate(initialValue.phases?.[0]?.dateStarted)
                .toISOString()
                .substr(0, 16),
              dateEnded: getValidDate(initialValue.phases?.[0]?.dateEnded)
                .toISOString()
                .substr(0, 16),
              phase: initialValue.phases?.[0].phase || "main",
              reason: "",
              groups: [],
              variationWeights:
                initialValue.phases?.[0].variationWeights ||
                getEvenSplit(
                  initialValue.variations ? initialValue.variations.length : 2
                ),
            }
          : {
              coverage: 1,
              dateStarted: new Date().toISOString().substr(0, 16),
              dateEnded: new Date().toISOString().substr(0, 16),
              phase: "main",
              reason: "",
              groups: [],
              variationWeights: [0.5, 0.5],
            },
      ],
      status: initialValue?.status || "running",
      ideaSource: idea || "",
    },
  });

  const datasource = getDatasourceById(form.watch("datasource"));

  const implementation = form.watch("implementation");

  const { apiCall } = useAuth();

  const {
    settings: { visualEditorEnabled },
  } = useUser();

  const onSubmit = form.handleSubmit(async (value) => {
    // Make sure there's an experiment name
    if (value.name.length < 1) {
      setStep(0);
      throw new Error("Experiment Name must not be empty");
    }

    // TODO: more validation?

    const data = { ...value };

    if (data.status === "draft") {
      data.phases = [];
    }

    if (data.status === "running") {
      data.phases[0].dateEnded = "";
    }

    const body = JSON.stringify(data);

    const res = await apiCall<{ experiment: ExperimentInterfaceStringDates }>(
      `/experiments`,
      {
        method: "POST",
        body,
      }
    );
    track("Create Experiment", {
      source,
      implementation: data.implementation || "code",
      numTags: data.tags.length,
      numMetrics: data.metrics.length,
      numVariations: data.variations.length,
    });
    refreshWatching();

    refreshTags(data.tags);
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
      header={"New Experiment Analysis"}
      close={onClose}
      docSection="experiments"
      submit={onSubmit}
      cta={"Save"}
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
    >
      <Page display="Basic Info">
        {msg && <div className="alert alert-info">{msg}</div>}
        <Field label="Name" required minLength={2} {...form.register("name")} />
        {visualEditorEnabled && !isImport && (
          <Field
            label="Use Visual Editor"
            options={[
              { display: "no", value: "code" },
              { display: "yes", value: "visual" },
            ]}
            {...form.register("implementation")}
          />
        )}
        <div className="form-group">
          <label>Tags</label>
          <TagsInput
            value={form.watch("tags")}
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
              value={form.watch("description")}
              setValue={(val) => form.setValue("description", val)}
            />
          </div>
        )}
        {(!isImport || fromFeature) && (
          <SelectField
            label="Data Source"
            value={form.watch("datasource")}
            onChange={(v) => form.setValue("datasource", v)}
            initialOption="Manual"
            options={datasources.map((d) => ({
              value: d.id,
              label: d.name,
            }))}
          />
        )}
        {datasource?.properties?.exposureQueries && (
          <SelectField
            label="Experiment Assignment Table"
            value={form.watch("exposureQueryId")}
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
        <Field
          label="Status"
          options={["draft", "running", "stopped"]}
          {...form.register("status")}
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
      </Page>
      <Page display="Variations">
        {status !== "draft" ? (
          <VariationsInput
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
              const existing = form.watch("variations");
              form.setValue(
                "variations",
                v.map((data, i) => {
                  const current = existing[i] || {
                    name: "",
                    key: "",
                    screenshots: [],
                  };
                  return {
                    ...current,
                    name: data.name || current?.name || "",
                    key: data.value || current?.key || "",
                  };
                })
              );
              form.setValue(
                "phases.0.variationWeights",
                v.map((v) => v.weight)
              );
            }}
            variations={
              form.watch("variations").map((v, i) => {
                return {
                  value: v.key || "",
                  name: v.name,
                  weight: form.watch(`phases.0.variationWeights.${i}`),
                };
              }) || []
            }
            coverageTooltip="This is just for documentation purposes and has no effect on the analysis."
            showPreview={false}
          />
        ) : (
          <VariationDataInput form={form} />
        )}
      </Page>
      <Page display="Goals">
        <div style={{ minHeight: 350 }}>
          <div className="form-group">
            <label className="font-weight-bold mb-1">Goal Metrics</label>
            <div className="mb-1 font-italic">
              Metrics you are trying to improve with this experiment.
            </div>
            <MetricsSelector
              selected={form.watch("metrics")}
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
              selected={form.watch("guardrails")}
              onChange={(metrics) => form.setValue("guardrails", metrics)}
              datasource={datasource?.id}
            />
          </div>
          {!isImport && implementation === "visual" && (
            <Field
              label="URL Targeting"
              {...form.register("targetURLRegex")}
              helpText={
                <>
                  e.g. <code>https://example.com/pricing</code> or{" "}
                  <code>^/post/[0-9]+</code>
                </>
              }
            />
          )}
        </div>
      </Page>
    </PagedModal>
  );
};

export default NewExperimentForm;
