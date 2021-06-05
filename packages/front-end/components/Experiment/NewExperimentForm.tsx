import { FC, useEffect, useState } from "react";
import { useAuth } from "../../services/auth";
import useForm from "../../hooks/useForm";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import TagsInput from "../TagsInput";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ImplementationType,
  Variation,
} from "back-end/types/experiment";
import { FaPlus, FaTrash } from "react-icons/fa";
import MetricsSelector from "./MetricsSelector";
import TextareaAutosize from "react-textarea-autosize";
import { useWatching } from "../../services/WatchProvider";
import MarkdownInput from "../Markdown/MarkdownInput";
import { useRouter } from "next/router";
import track from "../../services/track";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useContext } from "react";
import { UserContext } from "../ProtectedPage";
import RadioSelector from "../Forms/RadioSelector";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type NewExperimentFormProps = {
  initialStep?: number;
  initialValue?: Partial<ExperimentInterfaceStringDates>;
  initialNumVariations?: number;
  isImport?: boolean;
  includeDescription?: boolean;
  source: string;
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
}) => {
  const router = useRouter();
  const [step, setStep] = useState(initialStep || 0);

  const {
    metrics,
    datasources,
    getDatasourceById,
    refreshTags,
  } = useDefinitions();
  const { refreshWatching } = useWatching();

  const initialPhases: ExperimentPhaseStringDates[] = isImport
    ? [
        {
          coverage: 1,
          dateStarted: new Date(
            initialValue.phases?.[0]?.dateStarted || Date.now()
          )
            .toISOString()
            .substr(0, 16),
          dateEnded: new Date(initialValue.phases?.[0]?.dateEnded || Date.now())
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

  const [value, inputProps, manualUpdate] = useForm<
    Partial<ExperimentInterfaceStringDates>
  >({
    implementation: initialValue?.implementation || "code",
    trackingKey: initialValue?.trackingKey || "",
    datasource: initialValue?.datasource || datasources?.[0]?.id || "",
    userIdType: initialValue?.userIdType || "anonymous",
    name: initialValue?.name || "",
    hypothesis: initialValue?.hypothesis || "",
    activationMetric: initialValue?.activationMetric || "",
    metrics: initialValue?.metrics || [],
    tags: initialValue?.tags || [],
    targetURLRegex: initialValue?.targetURLRegex || "",
    description: initialValue?.description || "",
    variations:
      initialValue?.variations || getDefaultVariations(initialNumVariations),
    phases: initialPhases,
  });

  const variationKeys =
    getDatasourceById(value.datasource)?.settings?.variationIdFormat === "key";

  const deleteVariation = (i: number) => {
    const variations = [...value.variations];
    variations.splice(i, 1);
    manualUpdate({ variations });
  };
  const addVariation = () => {
    const variations = [
      ...value.variations,
      {
        name: `Variation ${value.variations.length}`,
        description: "",
        key: "",
        screenshots: [],
      },
    ];
    manualUpdate({ variations });
  };

  const { apiCall } = useAuth();

  const {
    settings: { implementationTypes },
  } = useContext(UserContext);
  const visualAllowed = implementationTypes.includes("visual");

  const onSubmit = async () => {
    // Make sure there's an experiment name
    if (value.name.length < 1) {
      setStep(0);
      throw new Error("Experiment Name must not be empty");
    }

    // TODO: more validation?

    const data = { ...value };
    if (isImport) {
      data.status = "stopped";
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
    });
    refreshWatching();

    refreshTags(data.tags);
    if (onCreate) {
      onCreate(res.experiment.id);
    } else {
      router.push(`/experiment/${res.experiment.id}`);
    }
  };

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
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            required
            minLength={2}
            className="form-control"
            {...inputProps.name}
          />
        </div>
        {visualAllowed && (
          <div className="form-group">
            <label>Type</label>
            <RadioSelector
              name="implementationType"
              value={value.implementation}
              setValue={(implementation: ImplementationType) =>
                manualUpdate({ implementation })
              }
              options={[
                {
                  key: "code",
                  display: "Code",
                  description:
                    "Using one of our Client Libraries (Javascript, React, PHP, or Ruby)",
                },
                {
                  key: "visual",
                  display: "Visual",
                  description: "Using our point & click Visual Editor",
                },
              ]}
            />
          </div>
        )}
        <div className="form-group">
          <label>Tags</label>
          <TagsInput
            value={value.tags}
            onChange={(tags) => {
              manualUpdate({ tags });
            }}
          />
        </div>
        {!isImport && (
          <div className="form-group">
            <label>Hypothesis</label>
            <TextareaAutosize
              className="form-control"
              minRows={2}
              maxRows={6}
              placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
              {...inputProps.hypothesis}
            />
          </div>
        )}
        {includeDescription && (
          <div className="form-group">
            <label>Description</label>
            <MarkdownInput
              value={value.description}
              setValue={(description) => manualUpdate({ description })}
            />
          </div>
        )}
        {!isImport && (
          <div className="form-group">
            <label>Data Source</label>
            <select className="form-control" {...inputProps.datasource}>
              <option value="">Manual</option>
              {datasources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isImport && (
          <>
            <div className="form-group">
              <label>Start Date (UTC)</label>
              <input
                type="datetime-local"
                className="form-control"
                {...inputProps.phases[0].dateStarted}
              />
            </div>
            <div className="form-group">
              <label>End Date (UTC)</label>
              <input
                type="datetime-local"
                className="form-control"
                {...inputProps.phases[0].dateEnded}
              />
            </div>
          </>
        )}
      </Page>
      <Page display="Variations">
        <div className="mb-3">
          <label>Variations</label>
          <div className="row align-items-center">
            {value.variations.map((v, i) => (
              <div
                className="col-lg-4 col-md-6 mb-2"
                key={i}
                style={{ minWidth: 200 }}
              >
                <div className="border p-2 bg-white">
                  <div>
                    {!isImport && value.variations.length > 2 ? (
                      <button
                        className="btn btn-outline-danger btn-sm float-right"
                        onClick={(e) => {
                          e.preventDefault();
                          deleteVariation(i);
                        }}
                      >
                        <FaTrash />
                      </button>
                    ) : (
                      ""
                    )}
                  </div>
                  <div className="form-group">
                    <label>{i === 0 ? "Control" : `Variation ${i}`} Name</label>
                    <input
                      className="form-control"
                      type="text"
                      {...inputProps.variations[i].name}
                    />
                  </div>
                  {variationKeys && (
                    <div className="form-group">
                      <label>Id</label>
                      <input
                        className="form-control"
                        type="text"
                        {...inputProps.variations[i].key}
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      className="form-control"
                      {...inputProps.variations[i].description}
                    />
                  </div>
                </div>
              </div>
            ))}
            {!isImport && (
              <div
                className="col-lg-4 col-md-6 mb-2 text-center"
                style={{ minWidth: 200 }}
              >
                <div className="p-3" style={{ border: "3px dotted #dee2e6" }}>
                  <button
                    className="btn btn-outline-success"
                    onClick={(e) => {
                      e.preventDefault();
                      addVariation();
                    }}
                  >
                    <FaPlus /> Variation
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
              {value.variations.map((v, i) => (
                <div className="col-auto mb-2" key={i}>
                  <div className="input-group">
                    <div className="input-group-prepend">
                      <div className="input-group-text">{v.name}</div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      className="form-control"
                      {...inputProps.phases[0].variationWeights[i]}
                    />
                  </div>
                </div>
              ))}
              <div className="col-auto">
                <button
                  className="btn btn-outline-secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    manualUpdate({
                      phases: [
                        {
                          ...value.phases[0],
                          variationWeights: getEvenSplit(
                            value.variations.length
                          ),
                        },
                      ],
                    });
                  }}
                >
                  Even Split
                </button>
              </div>
            </div>
          </div>
        )}
      </Page>
      <Page display="Metrics and Targeting">
        <div style={{ minHeight: 350 }}>
          <div className="form-group">
            <label>Metrics</label>
            <MetricsSelector
              selected={value.metrics}
              onChange={(metrics) => {
                manualUpdate({ metrics });
              }}
              datasource={value.datasource}
            />
          </div>
          {isImport && (
            <div className="form-group">
              <label>Activation Metric</label>
              <select {...inputProps.activationMetric} className="form-control">
                <option value="">None</option>
                {metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <small className="form-text text-muted">
                If set, users must convert on this metric before being included
                in the analysis.
              </small>
            </div>
          )}
          {getDatasourceById(value.datasource)?.type !== "mixpanel" && (
            <div className="form-group">
              <label>Login State</label>
              <select className="form-control" {...inputProps.userIdType}>
                <option value="user">User</option>
                <option value="anonymous">Anonymous</option>
              </select>
            </div>
          )}
          <div className="form-group">
            <label>URL Targeting</label>
            <input
              type="text"
              className="form-control"
              {...inputProps.targetURLRegex}
            />
            <small className="form-text text-muted">
              e.g. <code>https://example.com/pricing</code> or{" "}
              <code>^/post/[0-9]+</code>
            </small>
          </div>
        </div>
      </Page>
    </PagedModal>
  );
};

export default NewExperimentForm;
