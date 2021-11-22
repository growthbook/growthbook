import Link from "next/link";
import { useRouter } from "next/router";
import { FaCheck } from "react-icons/fa";
import { FeatureInterface } from "../../../back-end/types/feature";
import Code from "../../components/Code";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const { data, error } = useApi<{
    feature: FeatureInterface;
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

  return (
    <div className="contents container-fluid pagecontents">
      <h1>{fid}</h1>
      <Markdown>{data.feature.description}</Markdown>

      <h3>Values</h3>
      <table className="table appbox gbtable">
        <thead>
          <tr>
            <th>Default</th>
            <th>Key</th>
            <th>Name</th>
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
                <td>{value.key}</td>
                <td>{value.name}</td>
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

      <h3>Rules</h3>
      {data.feature.rules?.map((rule, i) => {
        return (
          <div key={i} className="appbox">
            {rule.condition && (
              <div className="row border-bottom mb-2">
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
              <div>
                Serve <code>{data.feature.values[rule.value].key}</code>
              </div>
            )}
            {rule.type === "rollout" && (
              <div>
                Percent Rollout
                <table className="table">
                  <thead>
                    <tr>
                      <th>Value</th>
                      <th>Percent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.weights.map((w, j) => (
                      <tr key={j}>
                        <td>{data.feature.values[j].key}</td>
                        <td>{percentFormatter.format(w)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rule.type === "experiment" && (
              <div>
                Run Experiment:{" "}
                <Link href={`/experiment/${rule.experiment}`}>
                  <a>{rule.experiment}</a>
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
