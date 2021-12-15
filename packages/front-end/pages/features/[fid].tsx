import Link from "next/link";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FeatureInterface,
  FeatureValueType,
  RolloutValue,
} from "back-end/types/feature";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { GBAddCircle, GBCircleArrowLeft } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import FeatureModal from "../../components/Features/FeatureModal";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import RuleModal from "../../components/Features/RuleModal";
import ConditionDisplay from "../../components/Features/ConditionDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

//const COLORS = ["#772eff", "#039dd1", "#fd7e14", "#e83e8c"];

function ExperimentSummary({
  exp,
  variations,
  type,
}: {
  exp: ExperimentInterfaceStringDates;
  variations: string[];
  type: FeatureValueType;
}) {
  const phase =
    exp.status !== "draft" && exp.phases
      ? exp.phases[exp.phases.length - 1]
      : undefined;

  return (
    <div>
      <div className="mb-2 row">
        <div className="col">
          <strong>EXPERIMENT</strong>
        </div>
        {phase && (
          <div className="col-auto">
            <Link href={`/experiment/${exp.id}#results`}>
              <a className="btn btn-primary btn-sm">View Results</a>
            </Link>
          </div>
        )}
      </div>
      <div className="row mb-3">
        <div className="col-auto">
          <Link href={`/experiment/${exp.id}`}>
            <a>{exp.name}</a>
          </Link>
        </div>
        <div className="col-auto">
          <StatusIndicator archived={exp.archived} status={exp.status} />
        </div>
        {phase && (
          <div className="col-auto">
            {percentFormatter.format(phase.coverage)} traffic
          </div>
        )}
      </div>

      <table className="table w-auto">
        <tbody>
          {variations.map((v, j) => (
            <tr key={j}>
              <td>{exp.variations[j].name}</td>
              <td>
                <ValueDisplay value={v} type={type} />
              </td>
              {phase && (
                <td>{percentFormatter.format(phase.variationWeights[j])}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForceSummary({
  value,
  type,
}: {
  value: string;
  type: FeatureValueType;
}) {
  return (
    <div className="row align-items-center">
      <div className="col-auto">
        <strong>SERVE</strong>
      </div>
      <div className="col">
        <ValueDisplay value={value} type={type} />
      </div>
    </div>
  );
}

function RolloutSummary({
  rollout,
  type,
}: {
  rollout: RolloutValue[];
  type: FeatureValueType;
}) {
  const totalPercent = rollout.reduce((sum, w) => sum + w.weight, 0);

  return (
    <div>
      <div className="mb-2 row">
        <div className="col">
          <strong>ROLLOUT</strong>
        </div>
        <div className="col-auto">
          <button className="btn btn-primary btn-sm">Analyze Impact</button>
        </div>
      </div>
      <table className="table table-bordered w-auto">
        <tbody>
          {rollout.map((r, j) => (
            <tr key={j}>
              <td>
                <ValueDisplay value={r.value} type={type} />
              </td>
              <td>{percentFormatter.format(r.weight)}</td>
            </tr>
          ))}
          {totalPercent < 1 && (
            <tr>
              <td>
                <em>unallocated</em>
              </td>
              <td>{percentFormatter.format(1 - totalPercent)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
        <Markdown>{data.feature.description}</Markdown>
      </div>

      <div className="mb-3">
        <h3>Default Value</h3>
        <ValueDisplay value={data.feature.defaultValue} type={type} />
      </div>

      <h3 className="mb-3">Override Rules</h3>
      {data.feature.rules?.map((rule, i) => {
        return (
          <div key={i} className="appbox p-3 mb-4 position-relative">
            <div
              className="position-absolute text-light border"
              style={{
                top: -12,
                left: -1,
                width: 35,
                height: 24,
                lineHeight: "24px",
                textAlign: "center",
                background: "#7C45EA",
              }}
            >
              {i + 1}
            </div>
            <div style={{ float: "right" }}>
              <MoreMenu id={"edit_rule_" + i}>
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setRuleModal(i);
                  }}
                >
                  edit rule
                </a>
                <DeleteButton
                  className="dropdown-item"
                  displayName="Rule"
                  useIcon={false}
                  text="delete rule"
                  onClick={async () => {
                    const rules = [...data.feature.rules];
                    rules.splice(i, 1);
                    await apiCall(`/feature/${fid}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        rules,
                      }),
                    });
                    mutate();
                  }}
                />
              </MoreMenu>
            </div>
            {rule.description && (
              <Markdown className="mb-3">{rule.description}</Markdown>
            )}
            {rule.condition && rule.condition !== "{}" && (
              <div className="row mb-3 align-items-top">
                <div className="col-auto">
                  <strong>IF</strong>
                </div>
                <div className="col">
                  <ConditionDisplay condition={rule.condition} />
                </div>
              </div>
            )}
            {rule.type === "force" && (
              <ForceSummary value={rule.value} type={type} />
            )}
            {rule.type === "rollout" && (
              <RolloutSummary rollout={rule.rollout} type={type} />
            )}
            {rule.type === "experiment" && (
              <ExperimentSummary
                exp={data.experiments[rule.experiment]}
                variations={rule.variations}
                type={type}
              />
            )}
          </div>
        );
      })}

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
