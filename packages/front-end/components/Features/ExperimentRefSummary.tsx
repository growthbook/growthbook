import { ExperimentRefRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

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

  if (!experiment) {
    return (
      <div className="alert alert-danger">
        The experiment could not be found
      </div>
    );
  }

  if (experiment.archived) {
    return (
      <div>
        <div className="alert alert-warning mb-2">
          This experiment is archived. This rule will be skipped.
        </div>
        <Link href={`/experiment/${experiment.id}`}>
          <a className="btn btn-outline-primary">View experiment</a>
        </Link>
      </div>
    );
  }

  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) {
    return (
      <div>
        <div className="alert alert-warning mb-2">
          The experiment is not running. This rule will be skipped.
        </div>
        <Link href={`/experiment/${experiment.id}`}>
          <a className="btn btn-outline-primary">View details</a>
        </Link>
      </div>
    );
  }

  if (experiment.status === "stopped") {
    const releasedValue = rule.variations.find(
      (v) => v.variationId === experiment.releasedVariationId
    );

    if (releasedValue) {
      return (
        <div>
          <div className="alert alert-info mb-2">
            <div className="d-flex">
              <div className="flex">
                This experiment was stopped and the winning variation is now
                being served to 100% of users.
              </div>
              <div>
                <Link href={`/experiment/${experiment.id}`}>
                  <a className="btn btn-outline-primary">View experiment</a>
                </Link>
              </div>
            </div>
          </div>
          <ForceSummary feature={feature} value={releasedValue.value} />;
        </div>
      );
    } else {
      return (
        <div>
          <div className="alert alert-warning mb-2">
            The experiment was stopped, but a winner was not selected. This rule
            will be skipped.
          </div>
          <Link href={`/experiment/${experiment.id}`}>
            <a className="btn btn-outline-primary">View details and results</a>
          </Link>
        </div>
      );
    }
  }

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * (phase.coverage ?? 1);

  return (
    <div>
      {experiment.status === "draft" && (
        <div className="alert alert-warning">
          The experiment is in a <strong>draft</strong> state. This rule will be
          skipped.
        </div>
      )}
      {phase.condition && phase.condition !== "{}" && (
        <div className="row mb-3 align-items-top">
          <div className="col-auto">
            <strong>IF</strong>
          </div>
          <div className="col">
            <ConditionDisplay condition={phase.condition} />
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
              <span className="mr-1 border px-2 py-1 bg-light rounded">
                {phase.namespace.name}
              </span>
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
          of users in the experiment
          {hasNamespace && (
            <>
              <span> (</span>
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(namespaceRange)}
              </span>{" "}
              of the namespace and{" "}
              <span className="border px-2 py-1 bg-light rounded">
                {/* @ts-expect-error TS(2769) If you come across this, please fix it!: No overload matches this call. */}
                {percentFormatter.format(coverage)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </div>
      </div>
      <strong>SERVE</strong>
      <table className="table mt-1 mb-3 bg-light gbtable">
        <tbody>
          {experiment.variations.map((variation, j) => {
            const value =
              variations.find((v) => v.variationId === variation.id)?.value ??
              "null";

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
                      backgroundColor: getVariationColor(j),
                    }}
                  />
                  {j}.
                </td>
                <td>
                  <ValueDisplay value={value} type={type} />
                  <ValidateValue value={value} feature={feature} />
                </td>
                <td>{variation.name}</td>
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
              </tr>
            );
          })}
          <tr>
            <td colSpan={4}>
              <ExperimentSplitVisual
                values={experiment.variations.map((variation, j) => {
                  return {
                    name: variation.name,
                    value:
                      variations.find((v) => v.variationId === variation.id)
                        ?.value ?? "null",
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
        <div className="col-auto">
          <Link href={`/experiment/${experiment.id}`}>
            <a className="btn btn-outline-primary">View details and results</a>
          </Link>
        </div>
      </div>
    </div>
  );
}
