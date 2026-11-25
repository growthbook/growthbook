import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { Trans, useLingui } from "@lingui/react/macro";
import { date } from "shared/dates";
import { calculateNamespaceCoverage } from "shared/util";
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
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const startDate = date(phase.dateStarted ?? "", "UTC");
  const endDate = phase.dateEnded ? date(phase.dateEnded, "UTC") : t`now`;

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && phase.namespace
      ? calculateNamespaceCoverage(phase.namespace)
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
            <Trans>
              <strong>{startDate}</strong> to <strong>{endDate}</strong>
            </Trans>
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
                <GBEdit /> <Trans>edit phase</Trans>
              </a>
            </div>
          )}
          <table className="table table-sm">
            <tr>
              <th className="small">
                <Trans>Coverage</Trans>
              </th>
              <td>{phaseSummary(phase)}</td>
            </tr>
            <tr>
              <th className="small">
                <Trans>Hash Seed</Trans>
              </th>
              <td>
                <code>{phase.seed}</code>
              </td>
            </tr>
            <tr>
              <th className="small">
                <Trans>Targeting</Trans>
              </th>
              <td>
                {phase.condition ? (
                  <ConditionDisplay condition={phase.condition} />
                ) : (
                  <em>
                    <Trans>none</Trans>
                  </em>
                )}
              </td>
            </tr>
            <tr>
              <th className="small">
                <Trans>Namespace</Trans>
              </th>
              <td>
                {hasNamespace ? (
                  `${phase.namespace!.name} (${percentFormatter.format(
                    namespaceRange,
                  )})`
                ) : (
                  <em>
                    <Trans>none</Trans>
                  </em>
                )}
              </td>
            </tr>
          </table>
        </div>
      )}
    </div>
  );
}
