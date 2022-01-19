import { FC, useEffect, useState } from "react";
import { useAuth } from "../../services/auth";
import { useFieldArray, useForm } from "react-hook-form";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import TagsInput from "../TagsInput";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  Variation,
} from "back-end/types/experiment";
import { MdDeleteForever } from "react-icons/md";
import MetricsSelector from "./MetricsSelector";
import { useWatching } from "../../services/WatchProvider";
import MarkdownInput from "../Markdown/MarkdownInput";
import { useRouter } from "next/router";
import track from "../../services/track";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";
import Field from "../Forms/Field";
import { getValidDate } from "../../services/dates";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type NewExperimentFormProps = {
  initialStep?: number;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialNumVariations?: number;
  isImport?: boolean;
  includeDescription?: boolean;
  source: string;
  idea?: string;
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
  includeDescription,
  source,
  idea,
}) => {
  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);
  const [showVariationIds] = useState(false);

  const {
    datasources,
    getDatasourceById,
    refreshTags,
    project,
  } = useDefinitions();
  const { refreshWatching } = useWatching();

  const initialPhases: ExperimentPhaseStringDates[] = isImport
    ? [
        {
          coverage: 1,
          dateStarted: getValidDate(initialValue.phases?.[0]?.dateStarted)
            .toISOString()
            .substr(0, 16),
          dateEnded: getValidDate(initialValue.phases?.[0]?.dateEnded)
            .toISOString()
            .substr(0, 16),
          phase: "main",
          reason: "",
          groups: [],
          variationWeights:
            initialValue.phases?.[0].variationWeights ||
            getEvenSplit(
              initialValue.variations ? initialValue.variations.length : 2
            ),
        },
      ]
    : [];

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
      userIdType: initialValue?.userIdType || "anonymous",
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
      phases: initialPhases,
      status: initialValue?.status || "running",
      ideaSource: idea || "",
    },
  });

  const variations = useFieldArray({
    name: "variations",
    control: form.control,
  });

  const datasource = getDatasourceById(form.watch("datasource"));

  const implementation = form.watch("implementation");

  const { apiCall } = useAuth();

  const {
    settings: { visualEditorEnabled },
  } = useContext(UserContext);

  const onSubmit = form.handleSubmit(async (value) => {
    // Make sure there's an experiment name
    if (value.name.length < 1) {
      setStep(0);
      throw new Error("Experiment Name must not be empty");
    }

    // TODO: more validation?

    const data = { ...value };
    if (!isImport) {
      data.status = "draft";
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

  return (
    <PagedModal
      header={isImport ? "Import Experiment" : "New Experiment"}
      close={onClose}
      submit={onSubmit}
      cta={"Save"}
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
    >
      <Page display="Basic Info">
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
        {!isImport && (
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
        {isImport && (
          <>
            <Field
              label="Status"
              options={["running", "stopped"]}
              {...form.register("status")}
            />
            <Field
              label="Start Date (UTC)"
              type="datetime-local"
              {...form.register("phases.0.dateStarted")}
            />
            {form.watch("status") === "stopped" && (
              <Field
                label="End Date (UTC)"
                type="datetime-local"
                {...form.register("phases.0.dateEnded")}
              />
            )}
          </>
        )}
      </Page>
      <Page display="Variations">
        <div className="mb-3">
          <div className="row equal">
            {variations.fields.map((v, i) => (
              <div
                className="col-lg-6 col-md-6 mb-2"
                key={i}
                style={{ minWidth: 200 }}
              >
                <div className="graybox">
                  <div className="row">
                    <div className={showVariationIds ? "col-8" : "col-12"}>
                      <Field
                        label={i === 0 ? "Control Name" : `Variation ${i} Name`}
                        {...form.register(`variations.${i}.name`)}
                      />
                    </div>
                    <div
                      className={`col-4 ${showVariationIds ? "" : "d-none"}`}
                    >
                      <Field
                        label="Id"
                        {...form.register(`variations.${i}.key`)}
                        placeholder={i + ""}
                      />
                    </div>
                  </div>
                  <Field
                    label="Description"
                    {...form.register(`variations.${i}.description`)}
                  />
                  <div className="text-right">
                    {!isImport && variations.fields.length > 2 ? (
                      <a
                        className="text-danger cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          variations.remove(i);
                        }}
                      >
                        <MdDeleteForever /> Delete
                      </a>
                    ) : (
                      ""
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!isImport && (
              <div
                className="col-lg-6 col-md-6 mb-2 text-center"
                style={{ minWidth: 200 }}
              >
                <div
                  className="p-3 h-100 d-flex align-items-center justify-content-center"
                  style={{ border: "1px dashed #C2C5D6", borderRadius: "3px" }}
                >
                  <button
                    className="btn btn-outline-primary"
                    onClick={(e) => {
                      e.preventDefault();
                      variations.append({
                        name: `Variation ${variations.fields.length}`,
                        description: "",
                        key: "",
                        screenshots: [],
                      });
                    }}
                  >
                    <span className="h4 pr-2 m-0 d-inline-block">
                      <GBAddCircle />
                    </span>{" "}
                    Add Variation
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {isImport && (
          <div className="form-group">
            <label>Traffic Split</label>
            <div className="row">
              {variations.fields.map((v, i) => (
                <div className="col-auto mb-2" key={i}>
                  <Field
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    {...form.register(`phases.0.variationWeights.${i}`, {
                      valueAsNumber: true,
                    })}
                    prepend={v.name}
                  />
                </div>
              ))}
              <div className="col-auto">
                <button
                  className="btn btn-outline-secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue(
                      "phases.0.variationWeights",
                      getEvenSplit(variations.fields.length)
                    );
                  }}
                >
                  Even Split
                </button>
              </div>
            </div>
          </div>
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
          {datasource?.properties?.userIds && implementation === "visual" && (
            <Field
              label="Login State"
              {...form.register("userIdType")}
              options={["user", "anonymous"]}
            />
          )}
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
