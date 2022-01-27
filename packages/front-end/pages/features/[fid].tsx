import Link from "next/link";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import { GBAddCircle, GBCircleArrowLeft } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import FeatureModal from "../../components/Features/FeatureModal";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import RuleModal from "../../components/Features/RuleModal";
import ForceSummary from "../../components/Features/ForceSummary";
import RuleList from "../../components/Features/RuleList";
import Code from "../../components/Code";
import { useMemo } from "react";
import { IfFeatureEnabled } from "@growthbook/growthbook-react";
import track from "../../services/track";

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);

  const [ruleDefaultType, setRuleDefaultType] = useState<string>("");
  const [ruleModal, setRuleModal] = useState<number | null>(null);

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
  }>(`/feature/${fid}`);

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
        <FeatureModal
          close={() => setEdit(false)}
          existing={data.feature}
          onSuccess={async (feature) => {
            mutate({ feature, experiments: data.experiments });
          }}
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
            <button
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                setEdit(true);
              }}
            >
              edit feature
            </button>
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
      <div className="mb-3">
        <Markdown>{data.feature.description || "*no description*"}</Markdown>
      </div>

      <div className="appbox mb-4 p-3">
        <h3 className="mb-3">Default Behavior</h3>
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
      <p>Powerful logic on top of your features</p>

      {data.feature.rules?.length > 0 && (
        <>
          <div className="appbox mb-4">
            <RuleList
              feature={data.feature}
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
            <h4>Segment Users</h4>
            <p>
              Override the default feature value for a subset of your users.
            </p>
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
                Add Rule
              </button>
            </div>
          </div>
        </div>
        <div className="col mb-3">
          <div
            className="bg-white border p-3 d-flex flex-column"
            style={{ height: "100%" }}
          >
            <h4>Gradual Roll-out</h4>
            <p>
              Safely release the feature to a small percent of users while you
              monitor the logs.
            </p>
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
                Add Rule
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
            <p>
              Perform an A/B test on this feature to measure the impact on your
              business.
            </p>
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
                Add Rule
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
