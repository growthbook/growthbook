import { ExperimentPhaseStringDates } from "back-end/types/experiment";
import { useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { date } from "@/services/dates";
import { phaseSummary } from "@/services/utils";
import ConditionDisplay from "../Features/ConditionDisplay";

export interface Props {
  i: number;
  phase: ExperimentPhaseStringDates;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ExpandablePhaseSummary({ i, phase }: Props) {
  const [expanded, setExpanded] = useState(false);

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;

  return (
    <div className={i ? "border-top" : ""}>
      <a
        className="d-flex text-dark p-3"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setExpanded(!expanded);
        }}
      >
        <div className="mr-2">{i + 1}:</div>
        <div className="small">
          <div style={{ fontSize: "1.2em" }}>{phase.name}</div>
          <div>
            <strong>{date(phase.dateStarted)}</strong> to{" "}
            <strong>{phase.dateEnded ? date(phase.dateEnded) : "now"}</strong>
          </div>
        </div>
        <div className="ml-auto">
          {expanded ? <FaCaretDown /> : <FaCaretRight />}
        </div>
      </a>
      {expanded && (
        <div className="mx-4 my-2">
          <div className="d-flex">
            <strong>Coverage:</strong>{" "}
            <div className="ml-auto">{phaseSummary(phase)}</div>
          </div>
          <div className="d-flex">
            <strong>Hash Seed:</strong>{" "}
            <code className="ml-auto">{phase.seed}</code>
          </div>
          <div className="d-flex">
            <strong>Targeting Condition:</strong>{" "}
            <div className="ml-auto">
              {phase.condition ? (
                <ConditionDisplay condition={phase.condition} />
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
          <div className="d-flex">
            <strong>Namespace:</strong>{" "}
            <div className="ml-auto">
              {hasNamespace ? (
                `${phase.namespace} (${percentFormatter.format(
                  namespaceRange
                )})`
              ) : (
                <em>none</em>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
