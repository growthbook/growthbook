import Link from "next/link";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import { GBAddCircle, GBCircleArrowLeft, GBEdit } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import RuleModal from "../../components/Features/RuleModal";
import ForceSummary from "../../components/Features/ForceSummary";
import RuleList from "../../components/Features/RuleList";
import Code from "../../components/Code";
import { useMemo } from "react";
import { IfFeatureEnabled } from "@growthbook/growthbook-react";
import track from "../../services/track";
import EditDefaultValueModal from "../../components/Features/EditDefaultValueModal";
import MarkdownInlineEdit from "../../components/Markdown/MarkdownInlineEdit";
import EnvironmentToggle from "../../components/Features/EnvironmentToggle";
import { useDefinitions } from "../../services/DefinitionsContext";
import EditProjectForm from "../../components/Experiment/EditProjectForm";
import { useFeaturesList } from "../../services/features";
import FeatureImplementationModal from "../../components/Features/FeatureImplementationModal";

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);

  const [ruleDefaultType, setRuleDefaultType] = useState<string>("");
  const [ruleModal, setRuleModal] = useState<number | null>(null);
  const [editProjectModal, setEditProjectModal] = useState(false);

  const { getProjectById, projects } = useDefinitions();

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
  }>(`/feature/${fid}`);

  const { features } = useFeaturesList();

  const firstFeature = features?.length === 0;
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const usage = useMemo(() => {
    if (!data?.feature) return "";
    const feature = data.feature;
    if (feature.valueType === "boolean") {
      return `if (growthbook.feature(${JSON.stringify(feature.id)}).on) {
  console.log("Feature is enabled!")
}`;
    }

    return `// Get latest feature value (may be null)
console.log(growthbook.feature(${JSON.stringify(feature.id)}).value);`;
  }, [data?.feature]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const type = data.feature.valueType;

  return (
    <div className="contents container-fluid pagecontents">
      {edit && (
        <EditDefaultValueModal
          close={() => setEdit(false)}
          feature={data.feature}
          mutate={mutate}
        />
      )}
      {ruleModal !== null && (
        <RuleModal
          feature={data.feature}
          close={() => setRuleModal(null)}
          i={ruleModal}
          mutate={mutate}
          defaultType={ruleDefaultType}
        />
      )}
      {editProjectModal && (
        <EditProjectForm
          apiEndpoint={`/feature/${data.feature.id}`}
          cancel={() => setEditProjectModal(false)}
          mutate={mutate}
          method="PUT"
          current={data.feature.project}
        />
      )}
      {showImplementation && (
        <FeatureImplementationModal
          feature={data.feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
      <div className="row align-items-center">
        <div className="col-auto">
          <Link href="/features">
            <a>
              <GBCircleArrowLeft /> Back to all features
            </a>
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <MoreMenu id="feature-more-menu">
            <a
              className="dropdown-item"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setShowImplementation(true);
              }}
            >
              Show implementation
            </a>
            <DeleteButton
              useIcon={false}
              displayName="Feature"
              onClick={async () => {
                await apiCall(`/feature/${data.feature.id}`, {
                  method: "DELETE",
                });
                router.push("/features");
              }}
              className="dropdown-item"
              text="delete feature"
            />
          </MoreMenu>
        </div>
      </div>

      <h1>{fid}</h1>
      {projects.length > 0 && (
        <div className="mb-2 row" style={{ fontSize: "0.8em" }}>
          <div className="col-auto">
            Project:{" "}
            {data.feature.project ? (
              <span className="badge badge-secondary">
                {getProjectById(data.feature.project)?.name || "unknown"}
              </span>
            ) : (
              <em className="text-muted">none</em>
            )}
            <a
              className="ml-2 cursor-pointer"
              onClick={() => setEditProjectModal(true)}
            >
              <GBEdit />
            </a>
          </div>
        </div>
      )}
      <div className="mb-3">
        <div className={data.feature.description ? "appbox mb-4 p-3" : ""}>
          <MarkdownInlineEdit
            value={data.feature.description}
            canEdit={true}
            canCreate={true}
            save={async (description) => {
              await apiCall(`/feature/${data.feature.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  description,
                }),
              });
              track("Update Feature Description");
              mutate();
            }}
          />
        </div>
      </div>

      <h3>Enabled Environments</h3>
      <div className="appbox mb-4 p-3">
        <div className="row mb-2">
          <div className="col-auto">
            <label className="font-weight-bold mr-2" htmlFor={"dev_toggle"}>
              Dev:{" "}
            </label>
            <EnvironmentToggle
              feature={data.feature}
              environment="dev"
              mutate={mutate}
              id="dev_toggle"
            />
          </div>
          <div className="col-auto">
            <label
              className="font-weight-bold mr-2"
              htmlFor={"production_toggle"}
            >
              Production:{" "}
            </label>
            <EnvironmentToggle
              feature={data.feature}
              environment="production"
              mutate={mutate}
              id="production_toggle"
            />
          </div>
        </div>
        <div>
          In a disabled environment, the feature will always evaluate to{" "}
          <code>null</code> and all override rules will be ignored.
        </div>
      </div>

      <h3>
        When Enabled
        <a className="ml-2 cursor-pointer" onClick={() => setEdit(true)}>
          <GBEdit />
        </a>
      </h3>
      <div className="appbox mb-4 p-3">
        <ForceSummary type={type} value={data.feature.defaultValue} />
      </div>

      {usage && (
        <IfFeatureEnabled feature="feature-usage-code">
          <div className="appbox p-3 mb-4">
            <h3 className="mb-3">Usage Example</h3>
            <Code
              language="javascript"
              code={usage}
              theme="light"
              className="border-0 p-0 m-0"
            />
          </div>
        </IfFeatureEnabled>
      )}

      <h3>Override Rules</h3>
      <p>
        Add powerful logic on top of your feature.{" "}
        {data.feature.rules?.length > 1 && "First matching rule applies."}
      </p>

      {data.feature.rules?.length > 0 && (
        <>
          <div className="appbox mb-4">
            <RuleList
              feature={data.feature}
              experiments={data.experiments || {}}
              mutate={mutate}
              setRuleModal={setRuleModal}
            />
          </div>
          <h4>Add more</h4>
        </>
      )}
      <div className="row">
        <div className="col mb-3">
          <div
            className="bg-white border p-3 d-flex flex-column"
            style={{ height: "100%" }}
          >
            <h4>Forced Value</h4>
            <p>Target groups of users and give them all the same value.</p>
            <div style={{ flex: 1 }} />
            <div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setRuleDefaultType("force");
                  setRuleModal(data?.feature?.rules?.length || 0);
                  track("Viewed Rule Modal", {
                    source: "add-rule",
                    type: "force",
                  });
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Forced Rule
              </button>
            </div>
          </div>
        </div>
        <div className="col mb-3">
          <div
            className="bg-white border p-3 d-flex flex-column"
            style={{ height: "100%" }}
          >
            <h4>Percentage Rollout</h4>
            <p>Release to a small percent of users while you monitor logs.</p>
            <div style={{ flex: 1 }} />
            <div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setRuleDefaultType("rollout");
                  setRuleModal(data?.feature?.rules?.length || 0);
                  track("Viewed Rule Modal", {
                    source: "add-rule",
                    type: "rollout",
                  });
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Rollout Rule
              </button>
            </div>
          </div>
        </div>
        <div className="col mb-3">
          <div
            className="bg-white border p-3 d-flex flex-column"
            style={{ height: "100%" }}
          >
            <h4>A/B Experiment</h4>
            <p>Measure the impact of this feature on your key metrics.</p>
            <div style={{ flex: 1 }} />
            <div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setRuleDefaultType("experiment");
                  setRuleModal(data?.feature?.rules?.length || 0);
                  track("Viewed Rule Modal", {
                    source: "add-rule",
                    type: "experiment",
                  });
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBAddCircle />
                </span>
                Add Experiment Rule
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
