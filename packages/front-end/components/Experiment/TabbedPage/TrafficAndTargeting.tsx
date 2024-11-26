import { MdInfoOutline } from "react-icons/md";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import useOrgSettings from "@/hooks/useOrgSettings";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function TrafficAndTargeting({
  phaseIndex = null,
  experiment,
  editTargeting,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases?.[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase.namespace.name)?.label ||
      phase.namespace.name
    : "";

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {phase ? (
        <>
          <div className="box p-4 my-4">
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <h4 className="m-0">Traffic Allocation</h4>
              <div className="flex-1" />
              {editTargeting &&
              !(isBandit && experiment.status === "running") ? (
                <button className="btn p-0 link-purple" onClick={editTargeting}>
                  <span className="text-purple">Edit</span>
                </button>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">Traffic</div>
                <div>
                  {Math.floor(phase.coverage * 100)}% included
                  {experiment.type !== "multi-armed-bandit" && (
                    <>, {formatTrafficSplit(phase.variationWeights, 2)} split</>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">
                  Assignment Attribute
                  {experiment.fallbackAttribute ? "s" : ""}{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie."
                  >
                    <MdInfoOutline className="text-info" />
                  </Tooltip>
                </div>
                <div>
                  {experiment.hashAttribute || "id"}
                  {experiment.fallbackAttribute ? (
                    <>, {experiment.fallbackAttribute} </>
                  ) : (
                    " "
                  )}
                  {
                    <HashVersionTooltip>
                      <small className="text-muted ml-1">
                        (V{experiment.hashVersion || 2} hashing)
                      </small>
                    </HashVersionTooltip>
                  }
                </div>
                {experiment.disableStickyBucketing ? (
                  <div className="mt-1">
                    Sticky bucketing: <em>disabled</em>
                  </div>
                ) : null}
              </div>

              <div className="col-4">
                <div className="h5">
                  Namespace{" "}
                  <Tooltip
                    popperStyle={{ lineHeight: 1.5 }}
                    body="Use namespaces to run mutually exclusive experiments. Manage namespaces under SDK Configuration → Namespaces"
                  >
                    <MdInfoOutline className="text-info" />
                  </Tooltip>
                </div>
                <div>
                  {hasNamespace ? (
                    <>
                      {namespaceName}{" "}
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

          <div className="box p-4 my-4">
            <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
              <h4 className="m-0">Targeting</h4>
              <div className="flex-1" />
              {editTargeting &&
              !(isBandit && experiment.status === "running") ? (
                <button className="btn p-0 link-purple" onClick={editTargeting}>
                  <span className="text-purple">Edit</span>
                </button>
              ) : null}
            </div>

            <div className="row">
              <div className="col-4">
                <div className="h5">Attribute Targeting</div>
                <div>
                  {phase.condition && phase.condition !== "{}" ? (
                    <ConditionDisplay condition={phase.condition} />
                  ) : (
                    <em>None</em>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">Saved Group Targeting</div>
                <div>
                  {phase.savedGroups?.length ? (
                    <SavedGroupTargetingDisplay
                      savedGroups={phase.savedGroups}
                    />
                  ) : (
                    <em>None</em>
                  )}
                </div>
              </div>

              <div className="col-4">
                <div className="h5">Prerequisite Targeting</div>
                <div>
                  {phase.prerequisites?.length ? (
                    <ConditionDisplay prerequisites={phase.prerequisites} />
                  ) : (
                    <em>None</em>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="alert alert-warning my-4">
          <FaExclamationTriangle className="mr-1" />
          No traffic allocation or targeting configured yet. Add a phase to this
          experiment.
        </div>
      )}
    </>
  );
}
