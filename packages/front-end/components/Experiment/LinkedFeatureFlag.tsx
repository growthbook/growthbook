import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaTimesCircle,
} from "react-icons/fa";
import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LinkedChange from "@/components/Experiment/LinkedChange";
import {
  getFeatureDefaultValue,
  getRules,
  useEnvironments,
} from "@/services/features";
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
      <div className="mt-2 pb-3 px-3">
        <div className="mb-3 d-flex align-items-center">
          <ClickToCopy className="h4 mb-0">{feature.id}</ClickToCopy>
          <Link href={`/features/${feature.id}`}>
            <a className="ml-4">
              manage feature <FaExternalLinkAlt />
            </a>
          </Link>
        </div>

        <div className="font-weight-bold mb-2">Default value</div>
        <div className="mb-4 px-3 py-2 ml-3 card">
          <ForceSummary
            value={getFeatureDefaultValue(feature)}
            feature={feature}
          />
        </div>

        <div className="font-weight-bold mb-2">Feature rules summary</div>
        <div className="mb-2 ml-3">
          {environments.map((en) => {
            const rules = getRules(feature, en.id);
            const experimentRules = rules.filter(
              (r) =>
                r.type === "experiment" &&
                r.trackingKey === experiment.trackingKey
            ) as ExperimentRule[];
            const indexOfLastExperimentRule = rules.indexOf(
              experimentRules[experimentRules.length - 1]
            );
            const rulesAboveExperiment = rules.filter(
              (r, i) =>
                i < indexOfLastExperimentRule &&
                !(
                  r.type === "experiment" &&
                  r.trackingKey === experiment.trackingKey
                )
            );

            return (
              <div className="mb-3 card px-3 py-2" key={en.id}>
                <div className="mb-2 pt-1 pb-2 border-bottom">
                  <span className="d-inline-block mr-3">Environment:</span>
                  <span className="font-weight-bold">{en.id}</span>
                </div>
                <div className="mb-2">
                  <span className="d-inline-block mr-3">Status:</span>
                  {feature.environmentSettings?.[en.id]?.enabled ? (
                    <span className="text-success text-uppercase small">
                      <FaCheckCircle /> enabled
                    </span>
                  ) : (
                    <span className="text-muted text-uppercase small">
                      <FaTimesCircle /> disabled
                    </span>
                  )}
                </div>
                <div className="mb-1">
                  <div>
                    <span className="d-inline-block mr-3">Feature rules:</span>
                    <span>
                      <span className="font-weight-bold">{rules.length}</span>
                      {experimentRules.length > 0 ? (
                        <>
                          <span className="text-muted ml-2">
                            ({experimentRules.length || 0} experiment)
                          </span>
                          {experimentRules.map((rule, i) => (
                            <div className="mt-1 mb-2" key={i}>
                              <div className="mt-2 mb-1">
                                <span className="font-weight-bold">
                                  Experiment rule values
                                </span>
                                {experimentRules.length > 1 ? (
                                  <span className="text-muted ml-2">
                                    (Rule {i + 1} of {experimentRules.length})
                                  </span>
                                ) : null}
                              </div>
                              <table className="table-sm table-bordered">
                                <tbody>
                                  {rule.values.map((v, j) => (
                                    <tr key={j}>
                                      <td
                                        className={`px-3 variation with-variation-right-shadow variation${j}`}
                                      >
                                        Variation {j}
                                      </td>
                                      <td className="px-3">
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
                        </>
                      ) : (
                        <span className="text-muted ml-2">
                          (No experiment rules)
                        </span>
                      )}
                    </span>
                  </div>
                  {rulesAboveExperiment.length > 0 ? (
                    <div className="mt-4 mb-2 alert alert-info px-3 py-2">
                      <FaExclamationTriangle className="mr-2" />
                      There {rulesAboveExperiment.length === 1
                        ? "is"
                        : "are"}{" "}
                      {rulesAboveExperiment.length || 0} rules above the
                      experiment rule.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LinkedChange>
  );
}
