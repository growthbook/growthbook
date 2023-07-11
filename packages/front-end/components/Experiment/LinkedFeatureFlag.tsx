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

  // Get all rules in all environments for this experiment
  const rules: {
    environmentId: string;
    i: number;
    enabled: boolean;
    rule: ExperimentRule;
  }[] = [];
  Object.entries(feature.environmentSettings).forEach(([env, settings]) => {
    settings?.rules?.forEach((rule, i) => {
      if (
        rule.type === "experiment" &&
        experiment.trackingKey === (rule.trackingKey || feature.id)
      ) {
        rules.push({
          environmentId: env,
          enabled: settings?.enabled && rule.enabled !== false,
          i,
          rule,
        });
      }
    });
  });

  const activeRules = rules.filter(({ enabled }) => enabled);
  const uniqueValueMappings = new Set(
    rules.map(({ rule }) => JSON.stringify(rule.values))
  );
  const rulesAbove = activeRules.some(({ i }) => i > 0);

  const environmentInfo = environments.map((env) => {
    const firstMatch =
      activeRules.find(({ environmentId }) => environmentId === env.id) ||
      rules.find(({ environmentId }) => environmentId === env.id);

    // Differentiate between enabled, different ways it can be disabled, and missing
    const state = firstMatch?.enabled
      ? "active"
      : firstMatch?.rule?.enabled === false
      ? "disabledRule"
      : firstMatch
      ? "disabledEnvironment"
      : "missing";

    return {
      id: env.id,
      color:
        state === "missing"
          ? "secondary"
          : state === "active"
          ? "primary"
          : "warning",
      active: state === "active",
      tooltip:
        state === "active"
          ? "The experiment is active in this environment"
          : state === "disabledEnvironment"
          ? "The environment is disabled for this feature, so the experiment is not active"
          : state === "disabledRule"
          ? "The experiment is disabled in this environment and is not active"
          : "The experiment does not exist in this environment",
    };
  });

  const firstRule = activeRules[0] || rules[0];

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
        <div className="mb-3">
          {environmentInfo.map((env) => (
            <Tooltip body={env.tooltip} key={env.id}>
              <span className={`badge badge-${env.color} mr-2`}>
                {env.active ? <FaCheck /> : <FaExclamationTriangle />} {env.id}
              </span>
            </Tooltip>
          ))}
        </div>

        <div className="font-weight-bold mb-2">Feature values</div>
        {firstRule && (
          <table className="table table-sm table-bordered w-auto">
            <tbody>
              {firstRule.rule.values.map((v, j) => (
                <tr key={j}>
                  <td
                    className={`px-3 variation with-variation-label with-variation-right-shadow border-right-0 variation${j}`}
                  >
                    <span className="name font-weight-bold">
                      {j}: {experiment.variations[j]?.name}
                    </span>
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
            with different values.{" "}
            {firstRule && (
              <>
                The values above are from the first experiment in{" "}
                <strong>{firstRule.environmentId}</strong>.
              </>
            )}
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
