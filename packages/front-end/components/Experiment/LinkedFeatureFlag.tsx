import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import LinkedChange from "@/components/Experiment/LinkedChange";
import Tooltip from "../Tooltip/Tooltip";
import ForceSummary from "../Features/ForceSummary";

type Props = {
  info: LinkedFeatureInfo;
  experiment: ExperimentInterfaceStringDates;
  open?: boolean;
};

export default function LinkedFeatureFlag({ info, experiment, open }: Props) {
  const orderedValues = experiment.variations.map((v) => {
    return info.values.find((v2) => v2.variationId === v.id)?.value || "";
  });

  return (
    <LinkedChange
      changeType={"flag"}
      feature={info.feature}
      additionalBadge={
        info.state === "draft" ? (
          <span className="badge badge-warning ml-3">draft</span>
        ) : info.state === "locked" ? (
          <span className="badge badge-danger ml-3">removed</span>
        ) : info.state === "live" ? (
          <span className="badge badge-success ml-3">live</span>
        ) : null
      }
      open={open ?? experiment.status === "draft"}
    >
      <div className="mt-2 pb-1 px-3">
        {info.state !== "locked" && (
          <div className="mb-3">
            <div className="font-weight-bold">Environments</div>
            {Object.entries(info.environmentStates || {}).map(
              ([env, state]) => (
                <Tooltip
                  body={
                    state === "active"
                      ? "The experiment is active in this environment"
                      : state === "disabled-env"
                      ? "The environment is disabled for this feature, so the experiment is not active"
                      : state === "disabled-rule"
                      ? "The experiment is disabled in this environment and is not active"
                      : "The experiment is not present in this environment"
                  }
                  key={env}
                >
                  <span
                    className={`badge ${
                      state === "missing"
                        ? "badge-secondary"
                        : state === "active"
                        ? "badge-primary"
                        : "badge-warning"
                    } mr-2`}
                  >
                    {state === "active" ? (
                      <FaCheck />
                    ) : (
                      <FaExclamationTriangle />
                    )}{" "}
                    {env}
                  </span>
                </Tooltip>
              )
            )}
          </div>
        )}

        <div className="font-weight-bold mb-2">Feature values</div>
        <table className="table table-sm table-bordered w-auto">
          <tbody>
            {orderedValues.map((v, j) => (
              <tr key={j}>
                <td
                  className={`px-3 variation with-variation-label with-variation-right-shadow border-right-0 variation${j}`}
                >
                  <span className="name font-weight-bold">
                    {j}: {experiment.variations[j]?.name}
                  </span>
                </td>
                <td className="px-3 border-left-0">
                  <ForceSummary value={v} feature={info.feature} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(info.state === "live" || info.state === "draft") && (
          <>
            {info.inconsistentValues && (
              <div className="alert alert-warning mt-2">
                <strong>Warning:</strong> This experiment is included multiple
                times with different values. The values above are from the first
                matching experiment in <strong>{info.valuesFrom}</strong>.
              </div>
            )}

            {info.rulesAbove && (
              <div className="alert alert-info mt-2">
                <strong>Notice:</strong> There are feature rules above this
                experiment so some users might not be included.
              </div>
            )}
          </>
        )}
      </div>
    </LinkedChange>
  );
}
