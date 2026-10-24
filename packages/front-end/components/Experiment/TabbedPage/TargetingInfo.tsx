import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import clsx from "clsx";
import { getNamespaceDisplayData } from "@/components/Features/NamespaceSelectorUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import { formatTrafficSplit } from "@/services/utils";
import SavedGroupTargetingDisplay from "@/components/Features/SavedGroupTargetingDisplay";
import useOrgSettings from "@/hooks/useOrgSettings";
import { GBInfo } from "@/components/Icons";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  showChanges?: boolean;
  changes?: ExperimentTargetingData;
  showFullTargetingInfo?: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function formatRanges(ranges: [number, number][]): string {
  return ranges.map(([start, end]) => `[${start} - ${end}]`).join(" ");
}

export default function TargetingInfo({
  experiment,
  showChanges,
  changes,
  showFullTargetingInfo = true,
}: Props) {
  const { namespaces } = useOrgSettings();

  const phase = experiment.phases[experiment.phases.length - 1];
  const hasNamespace = phase?.namespace && phase.namespace.enabled;

  // Calculate total namespace allocation
  const {
    coverage: namespaceCoverage,
    ranges: namespaceRanges,
    name: namespaceName,
  } = getNamespaceDisplayData(phase.namespace, namespaces);

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
  const {
    coverage: changesNamespaceCoverage,
    ranges: changesNamespaceRanges,
    name: changesNamespaceName,
  } = getNamespaceDisplayData(changes?.namespace, namespaces);

  return (
    <div>
      {phase ? (
        <div className="row">
          <div className="col">
            {(!showChanges ||
              showFullTargetingInfo ||
              hasSavedGroupsChanges ||
              hasConditionChanges ||
              hasPrerequisiteChanges) && (
              <>
                <div className="mb-3">
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
                <div className="mb-3">
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
                <div className="mb-3">
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
              <div className="mb-3">
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
                              ({percentFormatter.format(namespaceCoverage)})
                            </span>
                            {namespaceRanges.length > 0 && (
                              <span className="text-muted small ml-1">
                                {formatRanges(namespaceRanges)}
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
                              (
                              {percentFormatter.format(
                                changesNamespaceCoverage,
                              )}
                              )
                            </span>
                            {changesNamespaceRanges.length > 0 && (
                              <span className="text-muted small ml-1">
                                {formatRanges(changesNamespaceRanges)}
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

            {(!showChanges ||
              showFullTargetingInfo ||
              hasCoverageChanges ||
              hasVariationWeightsChanges) && (
              <div className="mb-3">
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
                <div className="mb-3">
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
                      <div>{formatTrafficSplit(phase.variationWeights, 2)}</div>
                    </div>
                    {hasVariationWeightsChanges && (
                      <div className="font-weight-bold text-success d-flex ml-4">
                        <div className="text-center" style={{ width: 20 }}>
                          →
                        </div>
                        <div>
                          {formatTrafficSplit(
                            changes?.variationWeights ?? [],
                            2,
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
