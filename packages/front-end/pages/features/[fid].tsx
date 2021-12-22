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

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);

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
        <div className="appbox p-3 mb-4">
          <h3 className="mb-3">Usage Example</h3>
          <Code
            language="javascript"
            code={usage}
            theme="light"
            className="border-0 p-0 m-0"
          />
        </div>
      )}

      <div className="appbox mb-4">
        <div className="p-3">
          <div className="row">
            <div className="col-auto">
              <h3 className="mb-0">Override Rules</h3>
            </div>
            <div className="col-auto">
              <small className="text-muted">Evaluated in order</small>
            </div>
          </div>
        </div>
        <RuleList
          feature={data.feature}
          mutate={mutate}
          setRuleModal={setRuleModal}
        />
      </div>

      <button
        className="btn btn-primary"
        onClick={() => setRuleModal(data?.feature?.rules?.length || 0)}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <GBAddCircle />
        </span>
        Add Rule
      </button>
    </div>
  );
}
