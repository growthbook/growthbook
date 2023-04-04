import {
  ExperimentRefRule,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import Link from "next/link";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import React, { ReactElement, useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { getVariationColor } from "../../services/features";
import { date, datetime } from "../../services/dates";
import { phaseSummary } from "../../services/utils";
import ResultsIndicator from "../Experiment/ResultsIndicator";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function ExperimentRefPhase({
  phase,
  experiment,
  rule,
  type,
}: {
  experiment: ExperimentInterfaceStringDates;
  phase: ExperimentPhaseStringDates;
  rule: ExperimentRefRule;
  type: FeatureValueType;
}) {
  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * phase.coverage;

  return (
    <div>
      <div className="mb-3 row">
        <div className="col-auto">
          <strong>SPLIT</strong>
        </div>
        <div className="col-auto">
          {" "}
          users by{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {experiment.hashAttribute || ""}
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
                {percentFormatter.format(phase.coverage)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </div>
      </div>
      <strong>SERVE</strong>

      <table className="table mt-1 mb-3 bg-light gbtable">
        <tbody>
          {experiment.variations.map((r, j) => (
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
                <ValueDisplay
                  value={rule.variations[j]?.value || ""}
                  type={type}
                />
              </td>
              <td>{r?.name}</td>
              <td>
                <div className="d-flex">
                  <div
                    style={{
                      width: "4em",
                      maxWidth: "4em",
                      margin: "0 0 0 auto",
                    }}
                  >
                    {percentFormatter.format(phase.variationWeights[j] || 0)}
                  </div>
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <ExperimentSplitVisual
                values={experiment.variations.map((v, i) => ({
                  value: rule.variations[i]?.value || "",
                  weight: phase.variationWeights[i] || 0,
                  name: v.name,
                }))}
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
      </div>
    </div>
  );
}

function ExperimentRefEndBehavior({
  experiment,
  rule,
  type,
}: {
  experiment: ExperimentInterfaceStringDates;
  rule: ExperimentRefRule;
  type: FeatureValueType;
}) {
  const results = experiment.results || "dnf";

  // Won or lost, roll out winning variation to 100%
  if (results === "won" || results === "lost") {
    const variation = results === "won" ? experiment.winner || 1 : 0;
    return (
      <div className="row align-items-top">
        <div className="col-auto">
          <strong>SERVE</strong>
        </div>
        <div className="col">
          <ValueDisplay
            value={rule.variations[variation]?.value || ""}
            type={type}
          />
        </div>
      </div>
    );
  }

  // TODO: dnf and inconclusive

  return null;
}

function ExperimentRefPhaseHeader({
  isOpen,
  setOpen,
  i,
  start,
  end,
  label,
  badge,
  additionalInfo,
  active,
}: {
  isOpen: boolean;
  setOpen: (open: number) => void;
  label: string;
  i: number;
  start?: string;
  end?: string;
  badge?: ReactElement;
  additionalInfo?: ReactElement;
  active?: boolean;
}) {
  return (
    <a
      href="#"
      className="row mb-2"
      onClick={(e) => {
        e.preventDefault();
        setOpen(isOpen ? -1 : i);
      }}
    >
      <div className="col-auto">
        <div
          title={active ? "Currently Active" : "Inactive"}
          style={{
            width: 20,
            height: 20,
            borderRadius: 20,
          }}
          className={active ? "bg-info" : "bg-secondary"}
        ></div>
      </div>
      <div className="col-auto">{label}:</div>
      {start && (
        <div className="col-auto">
          <strong title={datetime(start)}>{date(start)}</strong> to{" "}
          {end ? (
            <strong title={datetime(end)}>{date(end)}</strong>
          ) : (
            <strong>NOW</strong>
          )}
        </div>
      )}
      {additionalInfo && <div className="col-auto">{additionalInfo}</div>}
      {badge && <div className="col-auto">{badge}</div>}
      <div className="col-auto ml-auto">
        {isOpen ? <FaAngleDown /> : <FaAngleRight />}
      </div>
    </a>
  );
}

export default function ExperimentRefSummary({
  rule,
  experiment,
  feature,
}: {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
  rule: ExperimentRefRule;
}) {
  const phases = experiment.phases || [];
  const lastPhase = phases[phases.length - 1];
  const isFinished = lastPhase && experiment.status === "stopped";
  const [open, setOpen] = useState(
    isFinished ? phases.length : phases.length - 1
  );
  return (
    <div>
      <div className="list-group">
        {phases.map((phase, i) => {
          return (
            <div className="list-group-item" key={i}>
              <ExperimentRefPhaseHeader
                end={phase.dateEnded}
                start={phase.dateStarted}
                i={i}
                isOpen={open === i}
                label={`Phase ${i + 1}`}
                setOpen={setOpen}
                additionalInfo={phaseSummary(phase)}
                active={!isFinished && i === phases.length - 1}
              />
              <ExperimentRefPhase
                experiment={experiment}
                phase={phase}
                rule={rule}
                type={feature.valueType}
              />
            </div>
          );
        })}
        {isFinished && (
          <div className="list-group-item" key={phases.length}>
            <ExperimentRefPhaseHeader
              start={lastPhase.dateEnded}
              i={phases.length}
              isOpen={open === phases.length}
              label="Final"
              setOpen={setOpen}
              badge={<ResultsIndicator results={experiment.results} />}
              active={true}
            />
            <ExperimentRefEndBehavior
              experiment={experiment}
              rule={rule}
              type={feature.valueType}
            />
          </div>
        )}
      </div>
      <Link href={`/experiment/${experiment.id}#results`}>
        <a className="btn btn-outline-primary">View results</a>
      </Link>
    </div>
  );
}
