import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FaCheck, FaExclamationTriangle } from "react-icons/fa";
import { MatchingRule } from "shared/util";
import LinkedChange from "@/components/Experiment/LinkedChange";
import { useEnvironments } from "@/services/features";
import ForceSummary from "@/components/Features/ForceSummary";
import { useAuth } from "@/services/auth";
import Tooltip from "../Tooltip/Tooltip";
import DeleteButton from "../DeleteButton/DeleteButton";

type Props = {
  feature: FeatureInterface;
  rules: MatchingRule[];
  experiment: ExperimentInterfaceStringDates;
  mutateFeatures: () => void;
};

export default function LinkedFeatureFlag({
  feature,
  rules,
  experiment,
  mutateFeatures,
}: Props) {
  const environments = useEnvironments();

  const { apiCall } = useAuth();

  const activeRules = rules.filter(({ rule }) => rule.enabled);
  const liveRules = activeRules.filter(({ draft }) => !draft);

  // If all matching rules are drafts, it is unpublished
  const unpublished = !rules.some((r) => !r.draft);

  const uniqueValueMappings = new Set(
    rules.map(({ rule }) =>
      JSON.stringify(
        rule.type === "experiment"
          ? rule.values
          : rule.type === "experiment-ref"
          ? rule.variations
          : []
      )
    )
  );
  const rulesAbove = activeRules.some(({ i }) => i > 0);

  const isLegacy = rules.some((r) => r.rule.type === "experiment");

  const environmentInfo = environments.map((env) => {
    // First, prefer showing a live rule, then draft, then disabled
    const firstMatch =
      liveRules.find(({ environmentId }) => environmentId === env.id) ||
      activeRules.find(({ environmentId }) => environmentId === env.id) ||
      rules.find(({ environmentId }) => environmentId === env.id);

    // Differentiate between enabled, different ways it can be disabled, and missing
    const state = !firstMatch
      ? "missing"
      : !firstMatch.environmentEnabled
      ? "disabledEnvironment"
      : !firstMatch.rule.enabled
      ? "disabledRule"
      : firstMatch.draft
      ? "draft"
      : "active";

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
          : state === "draft"
          ? "The experiment rule is still a draft and has not been published yet"
          : "The experiment does not exist in this environment",
    };
  });

  const firstRule = activeRules[0] || rules[0];

  const orderedValues: string[] = [];
  if (firstRule) {
    experiment.variations.forEach((v, i) => {
      if (firstRule.rule.type === "experiment") {
        orderedValues.push(firstRule.rule.values[i]?.value || "");
      } else if (firstRule.rule.type === "experiment-ref") {
        orderedValues.push(
          firstRule.rule.variations.find((v2) => v2.variationId === v.id)
            ?.value || ""
        );
      }
    });
  }

  return (
    <LinkedChange
      changeType={"flag"}
      feature={feature}
      open={experiment.status === "draft"}
    >
      <div className="mt-2 pb-1 px-3">
        <div className="d-flex">
          {isLegacy && (
            <div className="alert alert-warning">
              <FaExclamationTriangle /> This feature contains a legacy
              experiment rule. Changes to this experiment (targeting conditions,
              variations, etc.) will not by synced to the feature flag
              automatically.
            </div>
          )}
          {experiment.status === "draft" && unpublished && (
            <div className="ml-auto">
              <DeleteButton
                displayName="Feature Rule"
                onClick={async () => {
                  await apiCall(`/feature/${feature.id}/experiment`, {
                    method: "DELETE",
                    body: JSON.stringify({
                      experimentId: experiment.id,
                    }),
                  });
                  mutateFeatures();
                }}
              />
            </div>
          )}
        </div>

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
                    <ForceSummary value={v} feature={feature} />
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
