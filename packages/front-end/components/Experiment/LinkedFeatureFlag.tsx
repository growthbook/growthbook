import { FaInfoCircle, FaTimesCircle } from "react-icons/fa";
import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import clsx from "clsx";
import LinkedChange from "@/components/Experiment/LinkedChange";
import { getRules, useEnvironments } from "@/services/features";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import ForceSummary from "@/components/Features/ForceSummary";

type Props = {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
};

export default function LinkedFeatureFlag({ feature, experiment }: Props) {
  const environments = useEnvironments();

  return (
    <LinkedChange
      changeType={"flag"}
      feature={feature}
      open={experiment.status === "draft"}
    >
      <div className="mt-2 pb-1 px-3">
        <div className="font-weight-bold">Feature key</div>
        <ClickToCopy className="mb-3">{feature.id}</ClickToCopy>

        <div className="font-weight-bold mb-2">Feature values</div>
        {environments.map((en) => {
          const rules = getRules(feature, en.id);
          console.log(rules);
          const experimentRules = rules.filter(
            (rule) =>
              rule.type === "experiment" &&
              experiment.trackingKey === (rule.trackingKey || feature.id)
          ) as ExperimentRule[];
          const indexOfLastExperimentRule = rules.indexOf(
            experimentRules[experimentRules.length - 1]
          );
          const rulesAboveExperiment = rules.filter(
            (rule, i) =>
              i < indexOfLastExperimentRule &&
              !(
                rule.type === "experiment" &&
                rule.trackingKey === experiment.trackingKey
              )
          );

          const disabledReasons: string[] = [];
          if (experimentRules.length === 0) {
            disabledReasons.push("no experiment rules");
          }
          if (!feature.environmentSettings?.[en.id]?.enabled) {
            disabledReasons.push("flag disabled");
          }

          return (
            <div
              className={clsx(`mb-3 appbox px-3 py-2`, {
                "bg-disabled": disabledReasons.length > 0,
                "bg-transparent": disabledReasons.length === 0,
              })}
              key={en.id}
            >
              <div className="my-1">
                <span className="mr-3 uppercase-title">Environment:</span>
                <span className="font-weight-bold">{en.id}</span>
              </div>

              {disabledReasons.length > 0 ? (
                <div className="ml-1 mt-2 mb-1 text-warning-orange">
                  <FaTimesCircle />
                  <span className="text-uppercase ml-1">Disabled</span>
                  <span className="ml-2">({disabledReasons.join(", ")})</span>
                </div>
              ) : null}

              {disabledReasons.length === 0 ? (
                <div className="mt-1 mb-2">
                  {experimentRules.map((rule, i) => (
                    <div className="mt-1 mb-2" key={i}>
                      <div className="mt-2 mb-1">
                        {experimentRules.length > 1 ? (
                          <span className="text-muted ml-2">
                            (Rule {i + 1} of {experimentRules.length})
                          </span>
                        ) : null}
                      </div>
                      <table className="table table-sm table-bordered w-auto">
                        <tbody>
                          {rule.values.map((v, j) => (
                            <tr key={j}>
                              <td
                                className={`px-3 variation with-variation-label with-variation-right-shadow border-right-0 variation${j}`}
                              >
                                <span className="name font-weight-bold">
                                  Variation {j}
                                </span>
                              </td>
                              <td className="px-3 border-left-0">
                                <ForceSummary
                                  value={v.value}
                                  feature={feature}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {rulesAboveExperiment.length > 0 ? (
                    <div className="mt-3 mb-1 alert alert-info px-3 py-2">
                      <FaInfoCircle className="mr-2" />
                      There {rulesAboveExperiment.length === 1
                        ? "is"
                        : "are"}{" "}
                      {rulesAboveExperiment.length} feature rules above this
                      experiment, so some users may not be included.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </LinkedChange>
  );
}
