import { MdInfoOutline } from "react-icons/md";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "../HashVersionSelector";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function TargetingInfo({
  phaseIndex = null,
  experiment,
  editTargeting,
}: Props) {
  const phase = experiment.phases[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;

  return (
    <div>
      <HeaderWithEdit
        edit={editTargeting || undefined}
        className="h3"
        containerClassName="mb-3"
      >
        Targeting
      </HeaderWithEdit>
      {phase ? (
        <div className="row">
          <div className="col">
            <div className="mb-3">
              <div className="mb-1">
                <strong>Experiment Key</strong>{" "}
                <Tooltip body="This is hashed together with the assignment attribute (below) to deterministically assign users to a variation." />
              </div>
              <div>{experiment.trackingKey}</div>
            </div>
            <div className="mb-3">
              <div className="mb-1">
                <strong>Assignment Attribute</strong>{" "}
                <Tooltip body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie.">
                  <MdInfoOutline className="text-info" />
                </Tooltip>
              </div>
              <div>
                {experiment.hashAttribute || "id"}{" "}
                {
                  <HashVersionTooltip>
                    <small className="text-muted ml-1">
                      (V{experiment.hashVersion || 2} hashing)
                    </small>
                  </HashVersionTooltip>
                }
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1">
                <strong>Saved Group Targeting</strong>
              </div>
              <div>
                {phase.savedGroups?.length ? (
                  <SavedGroupTargetingDisplay savedGroups={phase.savedGroups} />
                ) : (
                  <em>None</em>
                )}
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1">
                <strong>Attribute Targeting</strong>
              </div>
              <div>
                {phase.condition && phase.condition !== "{}" ? (
                  <ConditionDisplay condition={phase.condition} />
                ) : (
                  <em>None</em>
                )}
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1">
                <strong>Traffic</strong>
              </div>
              <div>
                {Math.floor(phase.coverage * 100)}% included,{" "}
                {formatTrafficSplit(phase.variationWeights)} split
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1">
                <strong>Namespace</strong>{" "}
                <Tooltip body="Use namespaces to run mutually exclusive experiments. Manage namespaces under SDK Configuration -> Namespaces">
                  <MdInfoOutline className="text-info" />
                </Tooltip>
              </div>
              <div>
                {hasNamespace ? (
                  <>
                    {phase.namespace.name}{" "}
                    <span className="text-muted">
                      ({percentFormatter.format(namespaceRange)})
                    </span>
                  </>
                ) : (
                  <em>Global (all users)</em>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <em>No targeting configured yet</em>
        </div>
      )}
    </div>
  );
}
