import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { calculateNamespaceCoverage } from "shared/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";
import {
  DetailSectionBox,
  DetailSectionColumn,
} from "@/components/DetailSectionBox";

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

  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && phase.namespace
      ? calculateNamespaceCoverage(phase.namespace)
      : 1;

  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase.namespace!.name)?.label ||
      phase.namespace!.name
    : "";

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";

  const canEditTargeting =
    editTargeting && !(isBandit && experiment.status === "running")
      ? editTargeting
      : null;

  return (
    <>
      {phase ? (
        <>
          <DetailSectionBox
            title="Traffic Allocation"
            onEdit={canEditTargeting}
          >
            <div className="row">
              <DetailSectionColumn label="Traffic">
                {!isHoldout && (
                  <>
                    {Math.floor(phase.coverage * 100)}% included
                    {experiment.type !== "multi-armed-bandit" && (
                      <>
                        , {formatTrafficSplit(phase.variationWeights, 2)} split
                      </>
                    )}
                  </>
                )}
                {isHoldout && (
                  <>
                    <div>
                      {Math.floor(
                        phase.coverage * phase.variationWeights[0] * 100,
                      )}
                      % in holdout
                    </div>
                    <div>
                      {Math.floor(
                        phase.coverage * phase.variationWeights[0] * 100,
                      )}
                      % not in holdout (for measurement)
                    </div>
                    <div>
                      {Math.floor(
                        (1 - phase.coverage * phase.variationWeights[0] * 2) *
                          100,
                      )}
                      % not in holdout (not for measurement)
                    </div>
                  </>
                )}
              </DetailSectionColumn>

              <DetailSectionColumn
                label={
                  <>
                    Assignment Attribute
                    {experiment.fallbackAttribute ? "s" : ""}{" "}
                    <Tooltip
                      popperStyle={{ lineHeight: 1.5 }}
                      body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie."
                    >
                      <GBInfo />
                    </Tooltip>
                  </>
                }
              >
                <div className="d-flex flex-wrap align-items-center gap-1">
                  <AttributeBadge
                    attributeId={experiment.hashAttribute || "id"}
                  />
                  {experiment.fallbackAttribute ? (
                    <>
                      ,{" "}
                      <AttributeBadge
                        attributeId={experiment.fallbackAttribute}
                      />
                    </>
                  ) : null}
                  {!isHoldout ? (
                    <HashVersionTooltip>
                      <small className="text-muted ml-1">
                        (V{experiment.hashVersion || 2} hashing)
                      </small>
                    </HashVersionTooltip>
                  ) : null}
                </div>
                {!isHoldout && experiment.disableStickyBucketing ? (
                  <div className="mt-1">
                    Sticky bucketing: <em>disabled</em>
                  </div>
                ) : null}
              </DetailSectionColumn>

              {!isHoldout && (
                <DetailSectionColumn
                  label={
                    <>
                      Namespace{" "}
                      <Tooltip
                        popperStyle={{ lineHeight: 1.5 }}
                        body="Use namespaces to run mutually exclusive experiments. Manage namespaces under Experimentation → Namespaces"
                      >
                        <GBInfo />
                      </Tooltip>
                    </>
                  }
                >
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
                </DetailSectionColumn>
              )}
            </div>
          </DetailSectionBox>

          <DetailSectionBox title="Targeting" onEdit={canEditTargeting}>
            <div className="row">
              <DetailSectionColumn label="Attribute Targeting">
                {phase.condition && phase.condition !== "{}" ? (
                  <ConditionDisplay condition={phase.condition} />
                ) : (
                  <em>None</em>
                )}
              </DetailSectionColumn>

              <DetailSectionColumn label="Saved Group Targeting">
                {phase.savedGroups?.length ? (
                  <SavedGroupTargetingDisplay savedGroups={phase.savedGroups} />
                ) : (
                  <em>None</em>
                )}
              </DetailSectionColumn>

              {!isHoldout && (
                <DetailSectionColumn label="Prerequisite Targeting">
                  {phase.prerequisites?.length ? (
                    <ConditionDisplay prerequisites={phase.prerequisites} />
                  ) : (
                    <em>None</em>
                  )}
                </DetailSectionColumn>
              )}
            </div>
          </DetailSectionBox>
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
