import { ExperimentRefRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { ReactElement } from "react";
import { includeExperimentInPayload } from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function isExperimentRefRuleSkipped(
  experiment: ExperimentInterfaceStringDates
) {
  if (experiment.status === "draft") return true;
  return !includeExperimentInPayload(experiment);
}

function ExperimentSkipped({
  color = "secondary",
  experimentId,
  message,
  cta = "View results",
}: {
  color?: string;
  experimentId?: string;
  message: string | ReactElement;
  cta?: string;
}) {
  return (
    <div className="mb-2">
      <div className={`alert alert-${color}`}>
        <div className="d-flex align-items-center">
          <div className="flex">{message}</div>
          {experimentId && (
            <div className="ml-auto">
              <Link
                href={`/experiment/${experimentId}`}
                className="btn btn-outline-primary"
              >
                {cta}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExperimentRefSummary({
  rule,
  experiment,
  feature,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRefRule;
}) {
  const { variations } = rule;
  const type = feature.valueType;

  const { namespaces } = useOrgSettings();

  const isBandit = experiment?.type === "multi-armed-bandit";

  if (!experiment) {
    return (
      <ExperimentSkipped
        message="The experiment could not be found"
        color="danger"
      />
    );
  }

  if (experiment.archived) {
    return (
      <ExperimentSkipped
        message="This experiment is archived. This rule will be skipped."
        experimentId={experiment.id}
        cta="View experiment"
      />
    );
  }

  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) {
    return (
      <ExperimentSkipped
        message="This experiment is not running. This rule will be skipped."
        experimentId={experiment.id}
        cta="View experiment"
      />
    );
  }

  const releasedValue =
    experiment.status === "stopped" && !experiment.excludeFromPayload
      ? rule.variations.find(
          (v) => v.variationId === experiment.releasedVariationId
        )
      : null;

  if (experiment.status === "stopped" && !releasedValue) {
    if (experiment.excludeFromPayload) {
      return (
        <ExperimentSkipped
          message={
            <>
              This experiment is stopped and does not have a{" "}
              <strong>Temporary Rollout</strong> enabled. This rule will be
              skipped.
            </>
          }
          experimentId={experiment.id}
        />
      );
    }

    return (
      <ExperimentSkipped
        message="This experiment is stopped, but a winning variation was not selected. This rule will be skipped"
        experimentId={experiment.id}
      />
    );
  }

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * (phase.coverage ?? 1);

  const hasCondition =
    (phase.condition && phase.condition !== "{}") ||
    !!phase.savedGroups?.length ||
    !!phase.prerequisites?.length;

  return (
    <div>
      {experiment.status === "draft" && (
        <div className="alert alert-warning">
          This {isBandit ? "Bandit" : "Experiment"} is in a{" "}
          <strong>draft</strong> state and has not been started yet. This rule
          will be skipped.
        </div>
      )}
      {experiment.status === "stopped" && (
        <div className="alert alert-info">
          This {isBandit ? "Bandit" : "Experiment"} is stopped and a{" "}
          <strong>Temporary Rollout</strong> is enabled. All users in the{" "}
          {isBandit ? "Bandit" : "Experiment"} will receive the winning
          variation. If no longer needed, you can stop it from the{" "}
          {isBandit ? "Bandit" : "Experiment"} page.
        </div>
      )}
      {hasCondition && (
        <div className="row mb-3 align-items-top">
          <div className="col-auto d-flex align-items-center">
            <strong>IF</strong>
          </div>
          <div className="col">
            <ConditionDisplay
              condition={phase.condition}
              savedGroups={phase.savedGroups}
              prerequisites={phase.prerequisites}
            />
          </div>
        </div>
      )}

      <div className="mb-3 row">
        <div className="col-auto">
          <strong>SPLIT</strong>
        </div>
        <div className="col-auto">
          {" "}
          users by{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {experiment.hashAttribute || "id"}
          </span>
          {hasNamespace && (
            <>
              {" "}
              <span>in the namespace </span>
              <Link href={`/namespaces`}>
                <span className="mr-1 border px-2 py-1 bg-light rounded">
                  {namespaces?.find((n) => n.name === phase.namespace.name)
                    ?.label || (
                    <span
                      className="italic text-danger"
                      title="this namespace is not found"
                    >
                      <FaExclamationTriangle /> {phase.namespace.name}
                    </span>
                  )}
                </span>
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="mb-3 row">
        <div className="col-auto">
          <strong>INCLUDE</strong>
        </div>
        <div className="col-auto">
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {percentFormatter.format(effectiveCoverage)}
          </span>{" "}
          of users in the {isBandit ? "Bandit" : "Experiment"}
          {hasNamespace && (
            <>
              <span> (</span>
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(namespaceRange)}
              </span>{" "}
              of the namespace and{" "}
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(phase?.coverage || 1)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </div>
      </div>
      {releasedValue ? (
        <ForceSummary feature={feature} value={releasedValue.value} />
      ) : (
        <>
          <strong>SERVE</strong>
          <table className="table mt-1 mb-3 bg-light gbtable">
            <tbody>
              {experiment.variations.map((variation, j) => {
                const value =
                  variations.find((v) => v.variationId === variation.id)
                    ?.value ?? "null";

                const weight = phase.variationWeights?.[j] || 0;

                return (
                  <tr key={j}>
                    <td
                      className="text-muted position-relative"
                      style={{ fontSize: "0.9em", width: 25 }}
                    >
                      <div
                        style={{
                          width: "6px",
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: 0,
                          backgroundColor: getVariationColor(j, true),
                        }}
                      />
                      {j}.
                    </td>
                    <td>
                      <ValueDisplay value={value} type={type} />
                      <ValidateValue value={value} feature={feature} />
                    </td>
                    <td>{variation.name}</td>
                    {!isBandit && (
                      <td>
                        <div className="d-flex">
                          <div
                            style={{
                              width: "4em",
                              maxWidth: "4em",
                              margin: "0 0 0 auto",
                            }}
                          >
                            {percentFormatter.format(weight)}
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!isBandit && (
                <tr>
                  <td colSpan={4}>
                    <ExperimentSplitVisual
                      values={experiment.variations.map((variation, j) => {
                        return {
                          name: variation.name,
                          value:
                            variations.find(
                              (v) => v.variationId === variation.id
                            )?.value ?? "null",
                          weight: phase.variationWeights?.[j] || 0,
                        };
                      })}
                      coverage={effectiveCoverage}
                      label="Traffic split"
                      unallocated="Not included (skips this rule)"
                      type={type}
                      showValues={false}
                      stackLeft={true}
                      showPercentages={true}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="row align-items-center">
            <div className="col-auto">
              <strong>TRACK</strong>
            </div>
            <div className="col">
              {" "}
              the result using the key{" "}
              <span className="mr-1 border px-2 py-1 bg-light rounded">
                {experiment.trackingKey}
              </span>{" "}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
