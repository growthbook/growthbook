import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { date } from "shared/dates";
import { phaseSummary } from "@/services/utils";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { GBEdit } from "@/components/Icons";

export interface Props {
  i: number;
  phase: ExperimentPhaseStringDates;
  editPhase?: (i: number | null) => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ExpandablePhaseSummary({ i, phase, editPhase }: Props) {
  const [expanded, setExpanded] = useState(false);

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace!.range[1] - phase.namespace!.range[0]
    : 1;

  return (
    <div className={i ? "border-top" : ""}>
      <a
        className={`d-flex text-dark ${i ? "pt-3" : ""} px-3 pb-3`}
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
            <strong>{date(phase.dateStarted ?? "", "UTC")}</strong> to{" "}
            <strong>
              {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
            </strong>
          </div>
        </div>
        <div className="ml-auto">
          {expanded ? <FaCaretDown /> : <FaCaretRight />}
        </div>
      </a>
      {expanded && (
        <div className="mx-3">
          {editPhase && (
            <div className="mb-2">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  editPhase(i);
                }}
              >
                <GBEdit /> edit phase
              </a>
            </div>
          )}
          <table className="table table-sm">
            <tr>
              <th className="small">Coverage</th>
              <td>{phaseSummary(phase)}</td>
            </tr>
            <tr>
              <th className="small">Hash Seed</th>
              <td>
                <code>{phase.seed}</code>
              </td>
            </tr>
            <tr>
              <th className="small">Targeting</th>
              <td>
                {phase.condition ? (
                  <ConditionDisplay condition={phase.condition} />
                ) : (
                  <em>none</em>
                )}
              </td>
            </tr>
            <tr>
              <th className="small">Namespace</th>
              <td>
                {hasNamespace ? (
                  `${phase.namespace!.name} (${percentFormatter.format(
                    namespaceRange,
                  )})`
                ) : (
                  <em>none</em>
                )}
              </td>
            </tr>
          </table>
        </div>
      )}
    </div>
  );
}
