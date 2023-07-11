import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import LinkedChange from "@/components/Experiment/LinkedChange";
import { useEnvironments } from "@/services/features";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ForceSummary from "@/components/Features/ForceSummary";
import Tooltip from "../Tooltip/Tooltip";

type Props = {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
};

export default function LinkedFeatureFlag({ feature, experiment }: Props) {
  const environments = useEnvironments();

  let matchingRule: ExperimentRule | undefined = undefined;
  let rulesAbove = false;
  const uniqueValueMappings = new Set<string>();
  const environmentInfo = environments.map((env) => {
    const settings = feature.environmentSettings?.[env.id];

    const rules = settings?.rules || [];
    let firstMatch = -1;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (
        rule.type === "experiment" &&
        experiment.trackingKey === (rule.trackingKey || feature.id)
      ) {
        if (firstMatch < 0) firstMatch = i;
        uniqueValueMappings.add(
          JSON.stringify(rule.values.map((v) => v.value))
        );
      }
    }

    if (firstMatch >= 0) {
      rulesAbove = rulesAbove || firstMatch >= 1;
      matchingRule = rules[firstMatch] as ExperimentRule;
    }

    const state =
      firstMatch >= 0 && settings?.enabled
        ? "active"
        : firstMatch >= 0
        ? "disabled"
        : "missing";

    return {
      id: env.id,
      color: state === "missing" ? "secondary" : "primary",
      disabled: state !== "active",
      tooltip:
        state === "active"
          ? "The experiment is active in this environment"
          : state === "disabled"
          ? "The experiment is in this environment, but the environment is disabled for this feature"
          : "The experiment does not exist in this environment",
    };
  });

  return (
    <LinkedChange
      changeType={"flag"}
      feature={feature}
      open={experiment.status === "draft"}
    >
      <div className="mt-2 pb-1 px-3">
        <div className="font-weight-bold">Feature key</div>
        <ClickToCopy className="mb-3">{feature.id}</ClickToCopy>

        <div className="font-weight-bold">Environments</div>
        <div className="mb-2">
          {environmentInfo.map((env) => (
            <Tooltip body={env.tooltip} key={env.id}>
              <span
                className={`badge badge-${env.color} mr-2`}
                style={env.disabled ? { opacity: 0.6 } : {}}
              >
                {env.disabled ? <FaExclamationTriangle /> : <FaCheck />}{" "}
                {env.id}
              </span>
            </Tooltip>
          ))}
        </div>

        <div className="font-weight-bold mb-2">Feature values</div>
        {matchingRule && (
          <table className="table table-sm table-bordered w-auto">
            <tbody>
              {(matchingRule as ExperimentRule).values.map((v, j) => (
                <tr key={j}>
                  <td
                    className={`px-3 variation with-variation-label with-variation-right-shadow border-right-0 variation${j}`}
                  >
                    <span className="name font-weight-bold">Variation {j}</span>
                  </td>
                  <td className="px-3 border-left-0">
                    <ForceSummary value={v.value} feature={feature} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {uniqueValueMappings.size > 1 && (
          <div className="alert alert-warning mt-2">
            <strong>Warning:</strong> This experiment is included multiple times
            in this feature with different values.
          </div>
        )}

        {rulesAbove && (
          <div className="alert alert-info mt-2">
            <strong>Notice:</strong> There are feature rules above this
            experiment so some users might not be included.
          </div>
        )}
      </div>
    </LinkedChange>
  );
}
