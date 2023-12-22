import { MdInfoOutline } from "react-icons/md";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
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
  noHeader?: boolean;
  targetingFieldsOnly?: boolean;
  separateTrafficSplitDisplay?: boolean;
  showDecimals?: boolean;
  showNamespaceRanges?: boolean;
  showChanges?: boolean;
  changes?: ExperimentTargetingData;
  showFullTargetingInfo?: boolean;
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
}: Props) {
  const phase = experiment.phases[phaseIndex ?? experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;
  const namespaceRange = hasNamespace
    ? phase.namespace.range[1] - phase.namespace.range[0]
    : 1;
  const namespaceRanges: [number, number] = hasNamespace
    ? [phase.namespace.range[1] || 0, phase.namespace.range[0] || 0]
    : [0, 1];

  const hasSavedGroupsChanges =
    showChanges &&
    JSON.stringify(changes?.savedGroups || []) !==
      JSON.stringify(phase.savedGroups || []);
  const hasConditionChanges =
    showChanges && changes?.condition !== phase.condition;
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
    ? changes.namespace.range[1] - changes.namespace.range[0]
    : 1;
  const changesNamespaceRanges: [number, number] = changes?.namespace
    ? [changes.namespace.range[1] || 0, changes.namespace.range[0] || 0]
    : [0, 1];

  return (
    <div>
      {!noHeader && (
        <HeaderWithEdit
          edit={editTargeting || undefined}
          className="h3"
          containerClassName="mb-3"
        >
          Targeting
        </HeaderWithEdit>
      )}
      {phase ? (
        <div className="row">
          <div className="col">
            {!targetingFieldsOnly && (
              <>
                <div className="mb-3">
                  <div className="mb-1">
                    <strong>Experiment Key</strong>{" "}
                    <Tooltip body="This is hashed together with the assignment attribute (below) to deterministically assign users to a variation." />
                  </div>
                  <div>{experiment.trackingKey}</div>
                </div>
                <div className="mb-3">
                  <div className="mb-1">
                    <strong>
                      Assignment Attribute
                      {experiment.fallbackAttribute ? "s" : ""}
                    </strong>{" "}
                    <Tooltip body="This user attribute will be used to assign variations. This is typically either a logged-in user id or an anonymous id stored in a long-lived cookie.">
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
                </div>
              </>
            )}
            {(!showChanges ||
              showFullTargetingInfo ||
              hasSavedGroupsChanges ||
              hasConditionChanges) && (
              <>
                <div className="mb-3">
                  <div className="mb-1">
                    <strong>Saved Group Targeting</strong>
                  </div>
                  <div className="d-flex">
                    {hasSavedGroupsChanges && (
                      <div
                        className="text-danger font-weight-bold text-center"
                        style={{ width: 20 }}
                      >
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
                    <>
                      <hr className="my-2" />
                      <div className="font-weight-bold text-success d-flex">
                        <div className="text-center" style={{ width: 20 }}>
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
                    </>
                  )}
                </div>
                <div className="mb-3">
                  <div className="mb-1">
                    <strong>Attribute Targeting</strong>
                  </div>
                  <div className="d-flex">
                    {hasConditionChanges && (
                      <div
                        className="text-danger font-weight-bold text-center"
                        style={{ width: 20 }}
                      >
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
                    <>
                      <hr className="my-2" />
                      <div className="font-weight-bold text-success d-flex">
                        <div className="text-center" style={{ width: 20 }}>
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
                    </>
                  )}
                </div>
              </>
            )}

            {!separateTrafficSplitDisplay ? (
              (!showChanges ||
                showFullTargetingInfo ||
                hasCoverageChanges ||
                hasVariationWeightsChanges) && (
                <div className="mb-3">
                  <div className="mb-1">
                    <strong>Traffic</strong>
                  </div>
                  <div className="d-flex">
                    {(hasCoverageChanges || hasVariationWeightsChanges) && (
                      <div
                        className="text-danger font-weight-bold text-center"
                        style={{ width: 20 }}
                      >
                        Δ
                      </div>
                    )}
                    <div>
                      {Math.floor(phase.coverage * 100)}% included,{" "}
                      {formatTrafficSplit(
                        phase.variationWeights,
                        showDecimals ? 2 : 0
                      )}{" "}
                      split
                    </div>
                  </div>
                  {(hasCoverageChanges || hasVariationWeightsChanges) && (
                    <div className="font-weight-bold text-success d-flex">
                      <div className="text-center" style={{ width: 20 }}>
                        →
                      </div>
                      <div>
                        {Math.floor((changes?.coverage ?? 1) * 100)}% included,{" "}
                        {formatTrafficSplit(
                          changes?.variationWeights ?? [],
                          showDecimals ? 2 : 0
                        )}{" "}
                        split
                      </div>
                    </div>
                  )}
                </div>
              )
            ) : (
              <>
                {(!showChanges ||
                  showFullTargetingInfo ||
                  hasCoverageChanges ||
                  hasVariationWeightsChanges) && (
                  <div className="mb-3">
                    <div>
                      <strong>Traffic percent</strong>
                    </div>
                    <div>
                      <div className="d-flex">
                        {hasCoverageChanges && (
                          <div
                            className="text-danger font-weight-bold text-center"
                            style={{ width: 20 }}
                          >
                            Δ
                          </div>
                        )}
                        <div>{percentFormatter.format(phase.coverage)}</div>
                      </div>
                      {hasCoverageChanges && (
                        <div className="font-weight-bold text-success d-flex">
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
                {(!showChanges ||
                  showFullTargetingInfo ||
                  hasCoverageChanges ||
                  hasVariationWeightsChanges) && (
                  <div className="mb-3">
                    <div>
                      <strong>Variation weights</strong>
                    </div>
                    <div>
                      <div className="d-flex">
                        {hasVariationWeightsChanges && (
                          <div
                            className="text-danger font-weight-bold text-center"
                            style={{ width: 20 }}
                          >
                            Δ
                          </div>
                        )}
                        <div>
                          {formatTrafficSplit(
                            phase.variationWeights,
                            showDecimals ? 2 : 0
                          )}
                        </div>
                      </div>
                      {hasVariationWeightsChanges && (
                        <div className="font-weight-bold text-success d-flex">
                          <div className="text-center" style={{ width: 20 }}>
                            →
                          </div>
                          <div>
                            {formatTrafficSplit(
                              changes?.variationWeights ?? [],
                              showDecimals ? 2 : 0
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {(!showChanges || showFullTargetingInfo || hasNamespaceChanges) && (
              <div className="mb-3">
                <div className="mb-1">
                  <strong>Namespace</strong>{" "}
                  <Tooltip body="Use namespaces to run mutually exclusive experiments. Manage namespaces under SDK Configuration → Namespaces">
                    <MdInfoOutline className="text-info" />
                  </Tooltip>
                </div>
                <div>
                  <div className="d-flex">
                    {hasNamespaceChanges && (
                      <div
                        className="text-danger font-weight-bold text-center"
                        style={{ width: 20 }}
                      >
                        Δ
                      </div>
                    )}
                    <div>
                      {hasNamespace ? (
                        <>
                          {phase.namespace.name}{" "}
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
                  <div className="font-weight-bold text-success d-flex">
                    <div className="text-center" style={{ width: 20 }}>
                      →
                    </div>
                    <div>
                      {changesHasNamespace ? (
                        <>
                          {changes?.namespace.name}{" "}
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
