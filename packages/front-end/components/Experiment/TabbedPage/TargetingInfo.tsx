import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import clsx from "clsx";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import { HashVersionTooltip } from "@/components/Experiment/HashVersionSelector";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";

export interface Props {
  phaseIndex?: number | null;
  experiment: ExperimentInterfaceStringDates;
  editTargeting?: (() => void) | null;
  noHeader?: boolean;
  targetingFieldsOnly?: boolean;
  separateTrafficSplitDisplay?: boolean;
  showDecimals?: boolean;
  showNamespaceRanges?: boolean;
  showChanges?: boolean;
  changes?: ExperimentTargetingData;
  showFullTargetingInfo?: boolean;
  horizontalView?: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function TargetingInfo({
  phaseIndex = null,
  experiment,
  editTargeting,
  noHeader,
  targetingFieldsOnly,
  separateTrafficSplitDisplay,
  showDecimals,
  showNamespaceRanges,
  showChanges,
  changes,
  showFullTargetingInfo = true,
  horizontalView,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  // Calculate total namespace allocation - support both old (single range) and new (multiple ranges) formats
  const namespaceRange = hasNamespace
    ? (() => {
        const ns = phase.namespace!;
        if ("ranges" in ns && ns.ranges && ns.ranges.length > 0) {
          return ns.ranges.reduce(
            (sum, [start, end]) => sum + (end - start),
            0,
          );
        } else if ("range" in ns && ns.range) {
          return ns.range[1] - ns.range[0];
        }
        return 1;
      })()
    : 1;

  const namespaceRanges: [number, number] = hasNamespace
    ? (() => {
        const ns = phase.namespace!;
        if ("ranges" in ns && ns.ranges && ns.ranges.length > 0) {
          // For display purposes, show the min and max across all ranges
          const allStarts = ns.ranges.map((r) => r[0]);
          const allEnds = ns.ranges.map((r) => r[1]);
          return [Math.max(...allEnds) || 0, Math.min(...allStarts) || 0];
        } else if ("range" in ns && ns.range) {
          return [ns.range[1] || 0, ns.range[0] || 0];
        }
        return [0, 1];
      })()
    : [0, 1];

  const namespaceName = hasNamespace
    ? namespaces?.find((n) => n.name === phase.namespace!.name)?.label ||
      phase.namespace!.name
    : "";

  const hasSavedGroupsChanges =
    showChanges &&
    JSON.stringify(changes?.savedGroups || []) !==
      JSON.stringify(phase.savedGroups || []);
  const hasConditionChanges =
    showChanges && changes?.condition !== phase.condition;
  const hasPrerequisiteChanges =
    showChanges &&
    JSON.stringify(changes?.prerequisites || []) !==
      JSON.stringify(phase.prerequisites || []);
  const hasCoverageChanges =
    showChanges && changes?.coverage !== phase.coverage;
  const hasVariationWeightsChanges =
    showChanges &&
    JSON.stringify(changes?.variationWeights || []) !==
      JSON.stringify(phase.variationWeights || []);
  const hasNamespaceChanges =
    showChanges &&
    JSON.stringify(changes?.namespace || {}) !==
      JSON.stringify(phase.namespace || {});
  const noChanges = !(
    hasSavedGroupsChanges ||
    hasConditionChanges ||
    hasCoverageChanges ||
    hasVariationWeightsChanges ||
    hasNamespaceChanges
  );

  const changesHasNamespace = changes?.namespace && changes.namespace.enabled;
  const changesNamespaceRange = changes?.namespace
    ? (() => {
        const ns = changes.namespace;
        if ("ranges" in ns && ns.ranges && ns.ranges.length > 0) {
          return ns.ranges.reduce(
            (sum, [start, end]) => sum + (end - start),
            0,
          );
        } else if ("range" in ns && ns.range) {
          return ns.range[1] - ns.range[0];
        }
        return 1;
      })()
    : 1;

  const changesNamespaceRanges: [number, number] = changes?.namespace
    ? (() => {
        const ns = changes.namespace;
        if ("ranges" in ns && ns.ranges && ns.ranges.length > 0) {
          const allStarts = ns.ranges.map((r) => r[0]);
          const allEnds = ns.ranges.map((r) => r[1]);
          return [Math.max(...allEnds) || 0, Math.min(...allStarts) || 0];
        } else if ("range" in ns && ns.range) {
          return [ns.range[1] || 0, ns.range[0] || 0];
        }
        return [0, 1];
      })()
    : [0, 1];

  const changesNamespaceName = changesHasNamespace
    ? namespaces?.find((n) => n.name === changes.namespace!.name)?.label ||
      changes.namespace!.name
    : "";

  return (
    <div>
      {!noHeader && (
        <HeaderWithEdit
          edit={editTargeting || undefined}
          className="h3"
          containerClassName="mb-3"
        >
          Targeting and Traffic
        </HeaderWithEdit>
      )}
      {phase ? (
        <div className="row">
          <div className={clsx("col", horizontalView && "d-flex flex-wrap")}>
            {!targetingFieldsOnly && (
              <>
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>Tracking Key</strong>{" "}
                    <Tooltip body="This is hashed together with the assignment attribute (below) to deterministically assign users to a variation." />
                  </div>
                  <div>{experiment.trackingKey}</div>
                </div>
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>
                      Assignment Attribute
                      {experiment.fallbackAttribute ? "s" : ""}
                    </strong>{" "}
                    <Tooltip body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie.">
                      <GBInfo />
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
                </div>
              </>
            )}

            {(!showChanges ||
              showFullTargetingInfo ||
              hasSavedGroupsChanges ||
              hasConditionChanges ||
              hasPrerequisiteChanges) && (
              <>
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>Saved Group targeting</strong>
                  </div>
                  <div className="d-flex">
                    <div
                      className={clsx("d-flex", {
                        "text-danger font-weight-bold mw-50":
                          hasSavedGroupsChanges,
                      })}
                    >
                      {hasSavedGroupsChanges && (
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          Δ
                        </div>
                      )}
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
                    {hasSavedGroupsChanges && (
                      <div className="font-weight-bold text-success d-flex ml-4">
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          →
                        </div>
                        <div>
                          {changes?.savedGroups?.length ? (
                            <SavedGroupTargetingDisplay
                              savedGroups={changes.savedGroups}
                            />
                          ) : (
                            <em>None</em>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>Attribute targeting</strong>
                  </div>
                  <div className="d-flex">
                    <div
                      className={clsx("d-flex", {
                        "text-danger font-weight-bold mw-50":
                          hasConditionChanges,
                      })}
                    >
                      {hasConditionChanges && (
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          Δ
                        </div>
                      )}
                      <div>
                        {phase.condition && phase.condition !== "{}" ? (
                          <ConditionDisplay condition={phase.condition} />
                        ) : (
                          <em>None</em>
                        )}
                      </div>
                    </div>
                    {hasConditionChanges && (
                      <div className="font-weight-bold text-success d-flex ml-4">
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          →
                        </div>
                        <div>
                          {changes?.condition && changes.condition !== "{}" ? (
                            <ConditionDisplay condition={changes.condition} />
                          ) : (
                            <em>None</em>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>Prerequisite targeting</strong>
                  </div>
                  <div className="d-flex">
                    <div
                      className={clsx("d-flex", {
                        "text-danger font-weight-bold mw-50":
                          hasPrerequisiteChanges,
                      })}
                    >
                      {hasPrerequisiteChanges && (
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          Δ
                        </div>
                      )}
                      <div>
                        {phase.prerequisites?.length ? (
                          <ConditionDisplay
                            prerequisites={phase.prerequisites}
                          />
                        ) : (
                          <em>None</em>
                        )}
                      </div>
                    </div>
                    {hasPrerequisiteChanges && (
                      <div className="font-weight-bold text-success d-flex ml-4">
                        <div className="text-center mx-1" style={{ width: 20 }}>
                          →
                        </div>
                        <div>
                          {changes?.prerequisites?.length ? (
                            <ConditionDisplay
                              prerequisites={changes.prerequisites}
                            />
                          ) : (
                            <em>None</em>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {(!showChanges || showFullTargetingInfo || hasNamespaceChanges) && (
              <div className={clsx("mb-3", horizontalView && "mr-4")}>
                <div className="mb-1">
                  <strong>Namespace targeting</strong>{" "}
                  <Tooltip body="Use namespaces to run mutually exclusive experiments. Manage namespaces under Experimentation → Namespaces">
                    <GBInfo />
                  </Tooltip>
                </div>
                <div className="d-flex">
                  <div>
                    <div
                      className={clsx("d-flex", {
                        "text-danger font-weight-bold": hasNamespaceChanges,
                      })}
                    >
                      {hasNamespaceChanges && (
                        <div className="text-center" style={{ width: 20 }}>
                          Δ
                        </div>
                      )}
                      <div>
                        {hasNamespace ? (
                          <>
                            {namespaceName}{" "}
                            <span className="text-muted">
                              ({percentFormatter.format(namespaceRange)})
                            </span>
                            {showNamespaceRanges && (
                              <span className="text-muted small ml-1">
                                [{namespaceRanges[0]} - {namespaceRanges[1]}]
                              </span>
                            )}
                          </>
                        ) : (
                          <em>Global (all users)</em>
                        )}
                      </div>
                    </div>
                  </div>
                  {hasNamespaceChanges && (
                    <div className="font-weight-bold text-success d-flex ml-4">
                      <div className="text-center" style={{ width: 20 }}>
                        →
                      </div>
                      <div>
                        {changesHasNamespace ? (
                          <>
                            {changesNamespaceName}{" "}
                            <span className="text-muted">
                              ({percentFormatter.format(changesNamespaceRange)})
                            </span>
                            {showNamespaceRanges && (
                              <span className="text-muted small ml-1">
                                [{changesNamespaceRanges[0]} -{" "}
                                {changesNamespaceRanges[1]}]
                              </span>
                            )}
                          </>
                        ) : (
                          <em>Global (all users)</em>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!separateTrafficSplitDisplay ? (
              (!showChanges ||
                showFullTargetingInfo ||
                hasCoverageChanges ||
                hasVariationWeightsChanges) && (
                <div className={clsx("mb-3", horizontalView && "mr-4")}>
                  <div className="mb-1">
                    <strong>Traffic</strong>
                  </div>
                  <div className="d-flex">
                    <div
                      className={clsx("d-flex", {
                        "text-danger font-weight-bold":
                          hasCoverageChanges || hasVariationWeightsChanges,
                      })}
                    >
                      {(hasCoverageChanges || hasVariationWeightsChanges) && (
                        <div className="text-center" style={{ width: 20 }}>
                          Δ
                        </div>
                      )}
                      <div>
                        {Math.floor(phase.coverage * 100)}% included
                        {experiment.type !== "multi-armed-bandit" && (
                          <>
                            ,{" "}
                            {formatTrafficSplit(
                              phase.variationWeights,
                              showDecimals ? 2 : 0,
                            )}{" "}
                            split
                          </>
                        )}
                      </div>
                    </div>
                    {(hasCoverageChanges || hasVariationWeightsChanges) && (
                      <div className="font-weight-bold text-success d-flex ml-4">
                        <div className="text-center" style={{ width: 20 }}>
                          →
                        </div>
                        <div>
                          {Math.floor((changes?.coverage ?? 1) * 100)}% included
                          {experiment.type !== "multi-armed-bandit" && (
                            <>
                              ,{" "}
                              {formatTrafficSplit(
                                changes?.variationWeights ?? [],
                                showDecimals ? 2 : 0,
                              )}{" "}
                              split
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              <>
                {(!showChanges ||
                  showFullTargetingInfo ||
                  hasCoverageChanges ||
                  hasVariationWeightsChanges) && (
                  <div className={clsx("mb-3", horizontalView && "mr-4")}>
                    <div>
                      <strong>Traffic percent</strong>
                    </div>
                    <div className="d-flex">
                      <div
                        className={clsx("d-flex", {
                          "text-danger font-weight-bold": hasCoverageChanges,
                        })}
                      >
                        {hasCoverageChanges && (
                          <div className="text-center" style={{ width: 20 }}>
                            Δ
                          </div>
                        )}
                        <div>{percentFormatter.format(phase.coverage)}</div>
                      </div>
                      {hasCoverageChanges && (
                        <div className="font-weight-bold text-success d-flex ml-4">
                          <div className="text-center" style={{ width: 20 }}>
                            →
                          </div>
                          <div>
                            {percentFormatter.format(changes?.coverage ?? 1)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {experiment.type !== "multi-armed-bandit" &&
                  (!showChanges ||
                    showFullTargetingInfo ||
                    hasCoverageChanges ||
                    hasVariationWeightsChanges) && (
                    <div className={clsx("mb-3", horizontalView && "mr-4")}>
                      <div>
                        <strong>Variation weights</strong>
                      </div>
                      <div className="d-flex">
                        <div
                          className={clsx("d-flex", {
                            "text-danger font-weight-bold":
                              hasVariationWeightsChanges,
                          })}
                        >
                          {hasVariationWeightsChanges && (
                            <div className="text-center" style={{ width: 20 }}>
                              Δ
                            </div>
                          )}
                          <div>
                            {formatTrafficSplit(
                              phase.variationWeights,
                              showDecimals ? 2 : 0,
                            )}
                          </div>
                        </div>
                        {hasVariationWeightsChanges && (
                          <div className="font-weight-bold text-success d-flex ml-4">
                            <div className="text-center" style={{ width: 20 }}>
                              →
                            </div>
                            <div>
                              {formatTrafficSplit(
                                changes?.variationWeights ?? [],
                                showDecimals ? 2 : 0,
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <em>No targeting configured yet</em>
        </div>
      )}
      {showChanges && !showFullTargetingInfo && noChanges && (
        <div className="mb-3">
          <em>No changes</em>
        </div>
      )}
    </div>
  );
}
