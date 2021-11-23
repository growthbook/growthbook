import Link from "next/link";
import { useRouter } from "next/router";
import { FaCheck } from "react-icons/fa";
import { ExperimentInterfaceStringDates } from "../../../back-end/types/experiment";
import { FeatureInterface } from "../../../back-end/types/feature";
import Code from "../../components/Code";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import StatusIndicator from "../../components/Experiment/StatusIndicator";
import { GBCircleArrowLeft } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function ExperimentSummary({
  exp,
  variations,
  keys,
}: {
  exp: ExperimentInterfaceStringDates;
  variations: number[];
  keys: string[];
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
                <span className="badge badge-primary">{keys[j]}</span>
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

function ForceSummary({ value, keys }: { value: number; keys: string[] }) {
  return (
    <div className="row align-items-center">
      <div className="col-auto">
        <strong>SERVE</strong>
      </div>
      <div className="col">
        <span className="badge badge-primary">{keys[value]}</span>
      </div>
    </div>
  );
}

function RolloutSummary({
  weights,
  keys,
}: {
  weights: number[];
  keys: string[];
}) {
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
      <table className="table w-auto">
        <tbody>
          {weights.map((w, j) => (
            <tr key={j}>
              <td>
                <span className="badge badge-primary">{keys[j]}</span>
              </td>
              <td>{percentFormatter.format(w)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const { data, error } = useApi<{
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

  const keys = data.feature.values.map((v) => v.key);

  return (
    <div className="contents container-fluid pagecontents">
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
          <MoreMenu id="feature-more-menu"></MoreMenu>
        </div>
      </div>

      <h1>{fid}</h1>
      <div className="mb-3">
        <Markdown>{data.feature.description}</Markdown>
      </div>

      <h3>Values</h3>
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th style={{ maxWidth: 40 }}>Default</th>
            <th>Key</th>
            <th>Description</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.feature.values.map((value, i) => {
            return (
              <tr key={i}>
                <td>
                  {i === data.feature.defaultValue ? (
                    <FaCheck className="text-success" />
                  ) : null}
                </td>
                <td>
                  <span className="badge badge-primary">{value.key}</span>
                </td>
                <td>
                  <Markdown>{value.description}</Markdown>
                </td>
                <td>
                  <Code language="json" code={value.value} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
            {rule.description && (
              <Markdown className="mb-3">{rule.description}</Markdown>
            )}
            {rule.condition && (
              <div className="row mb-3 align-items-center">
                <div className="col-auto">
                  <strong>IF</strong>
                </div>
                <div className="col">
                  <Code
                    language="json"
                    code={rule.condition.replace(/\n/g, "")}
                  />
                </div>
              </div>
            )}
            {rule.type === "force" && (
              <ForceSummary value={rule.value} keys={keys} />
            )}
            {rule.type === "rollout" && (
              <RolloutSummary weights={rule.weights} keys={keys} />
            )}
            {rule.type === "experiment" && (
              <ExperimentSummary
                exp={data.experiments[rule.experiment]}
                variations={rule.variations}
                keys={keys}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
