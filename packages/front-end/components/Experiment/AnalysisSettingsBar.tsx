import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import React, { useState } from "react";
import { ExperimentReportVariation } from "back-end/types/report";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { FaExclamationCircle } from "react-icons/fa";
import { OrganizationSettings } from "back-end/types/organization";
import { getValidDate } from "shared/dates";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getSnapshotAnalysis } from "shared/util";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
} from "shared/experiments";
import { FaMagnifyingGlassChart } from "react-icons/fa6";
import { RiBarChartFill } from "react-icons/ri";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Toggle from "@/components/Forms/Toggle";
import { GBCuped } from "@/components/Icons";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { trackSnapshot } from "@/services/track";
import VariationChooser from "@/components/Experiment/VariationChooser";
import BaselineChooser from "@/components/Experiment/BaselineChooser";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AnalysisForm from "./AnalysisForm";
import ResultMoreMenu from "./ResultMoreMenu";
import PhaseSelector from "./PhaseSelector";
import { useSnapshot } from "./SnapshotProvider";
import DifferenceTypeChooser from "./DifferenceTypeChooser";

export default function AnalysisSettingsBar({
  mutateExperiment,
  setAnalysisSettings,
  editMetrics,
  editPhases,
  variations,
  alwaysShowPhaseSelector = false,
  regressionAdjustmentAvailable,
  regressionAdjustmentEnabled,
  regressionAdjustmentHasValidMetrics,
  onRegressionAdjustmentChange,
  showMoreMenu = true,
  variationFilter,
  setVariationFilter,
  baselineRow,
  setBaselineRow,
  differenceType,
  setDifferenceType,
  envs,
}: {
  mutateExperiment: () => void;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  editMetrics?: () => void;
  editPhases?: () => void;
  variations: ExperimentReportVariation[];
  envs: string[];
  alwaysShowPhaseSelector?: boolean;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  onRegressionAdjustmentChange?: (enabled: boolean) => Promise<void>;
  showMoreMenu?: boolean;
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
  differenceType?: DifferenceType;
  setDifferenceType?: (differenceType: DifferenceType) => void;
}) {
  const {
    experiment,
    snapshot,
    analysis,
    dimension,
    mutateSnapshot: mutate,
    phase,
    setDimension,
    setSnapshotType,
  } = useSnapshot();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );

  const permissionsUtil = usePermissionsUtil();
  const canEditAnalysisSettings =
    experiment && permissionsUtil.canUpdateExperiment(experiment, {});

  const [modalOpen, setModalOpen] = useState(false);

  const { apiCall } = useAuth();

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const manualSnapshot = !datasource;

  const isBandit = experiment?.type === "multi-armed-bandit";

  return (
    <div>
      {modalOpen && experiment && (
        <AnalysisForm
          envs={envs}
          cancel={() => setModalOpen(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={phase}
          source={"analysis-settings-bar"}
        />
      )}

      {experiment && (
        <div className="row align-items-center p-3 analysis-settings-bar">
          {setVariationFilter && setBaselineRow ? (
            <>
              <div className="col-auto form-inline pr-5">
                <BaselineChooser
                  variations={experiment.variations}
                  setVariationFilter={setVariationFilter}
                  baselineRow={baselineRow ?? 0}
                  setBaselineRow={setBaselineRow}
                  snapshot={snapshot}
                  analysis={analysis}
                  setAnalysisSettings={setAnalysisSettings}
                  mutate={mutate}
                  dropdownEnabled={
                    !manualSnapshot && snapshot?.dimension !== "pre:date"
                  }
                />
                <em className="text-muted mx-3" style={{ marginTop: 15 }}>
                  vs
                </em>
                <VariationChooser
                  variations={experiment.variations}
                  variationFilter={variationFilter ?? []}
                  setVariationFilter={setVariationFilter}
                  baselineRow={baselineRow ?? 0}
                  dropdownEnabled={snapshot?.dimension !== "pre:date"}
                />
              </div>
            </>
          ) : null}
          <div className="col-auto form-inline pr-5">
            <DimensionChooser
              value={dimension}
              setValue={setDimension}
              activationMetric={!!experiment.activationMetric}
              datasourceId={experiment.datasource}
              exposureQueryId={experiment.exposureQueryId}
              userIdType={experiment.userIdType}
              labelClassName="mr-2"
              setVariationFilter={setVariationFilter}
              setBaselineRow={setBaselineRow}
              setDifferenceType={setDifferenceType}
              setAnalysisSettings={setAnalysisSettings}
            />
          </div>
          {!manualSnapshot && setDifferenceType ? (
            <div className="col-auto form-inline pr-5">
              <DifferenceTypeChooser
                differenceType={differenceType ?? "relative"}
                setDifferenceType={setDifferenceType}
                snapshot={snapshot}
                analysis={analysis}
                setAnalysisSettings={setAnalysisSettings}
                mutate={mutate}
                phase={phase}
              />
            </div>
          ) : null}
          {experiment.phases &&
            (alwaysShowPhaseSelector || experiment.phases.length > 1) && (
              <div className="col-auto form-inline">
                <PhaseSelector
                  mutateExperiment={mutateExperiment}
                  editPhases={!isBandit ? editPhases : undefined}
                  isBandit={isBandit}
                />
              </div>
            )}
          <div style={{ flex: 1 }} />
          {!isBandit && (
            <div className="col-auto">
              {regressionAdjustmentAvailable && (
                <PremiumTooltip
                  commercialFeature="regression-adjustment"
                  className="form-inline"
                >
                  <label
                    htmlFor={"toggle-experiment-regression-adjustment"}
                    className={`d-flex btn btn-outline-${
                      !hasRegressionAdjustmentFeature
                        ? "teal-disabled"
                        : regressionAdjustmentEnabled
                        ? "teal"
                        : "teal-off"
                    } my-0 pl-2 pr-1 py-1 form-inline`}
                  >
                    <GBCuped />
                    <span className="mx-1 font-weight-bold">CUPED</span>
                    <Toggle
                      id="toggle-experiment-regression-adjustment"
                      value={!!regressionAdjustmentEnabled}
                      setValue={(value) => {
                        if (
                          onRegressionAdjustmentChange &&
                          hasRegressionAdjustmentFeature
                        ) {
                          onRegressionAdjustmentChange(value).catch((e) => {
                            console.error(e);
                          });
                        }
                      }}
                      className={`teal m-0`}
                      style={{ transform: "scale(0.8)" }}
                      disabled={
                        !hasRegressionAdjustmentFeature ||
                        !canEditAnalysisSettings
                      }
                    />
                    {!regressionAdjustmentHasValidMetrics && (
                      <Tooltip
                        popperClassName="text-left"
                        body={
                          <>
                            <p>
                              This experiment does not have any metrics suitable
                              for CUPED regression adjustment.
                            </p>
                            <p className="mb-0">
                              Please check your metric definitions, as well as
                              any experiment-level metric overrides.
                            </p>
                          </>
                        }
                      >
                        <div
                          className="text-warning-orange position-absolute p-1"
                          style={{ top: -11, right: 2 }}
                        >
                          <FaExclamationCircle />
                        </div>
                      </Tooltip>
                    )}
                  </label>
                </PremiumTooltip>
              )}
            </div>
          )}
          {isBandit && snapshot ? (
            <div className="col-auto text-right mb-0">
              <div className="uppercase-title text-muted">Analysis type</div>
              <div>
                {snapshot?.type === "exploratory" ? (
                  <Tooltip
                    body={
                      <div className="text-left">
                        <p>This is an exploratory analysis.</p>
                        <p>
                          Exploratory analyses do not cause bandit variation
                          weights to change.
                        </p>
                      </div>
                    }
                  >
                    <FaMagnifyingGlassChart /> Exploratory
                  </Tooltip>
                ) : snapshot?.type === "standard" ? (
                  <Tooltip
                    body={
                      <div className="text-left">
                        <p>This is a standard analysis.</p>
                        <p>
                          Bandit variation weights may have changed in response
                          to this analysis.
                        </p>
                      </div>
                    }
                  >
                    <RiBarChartFill /> Standard
                  </Tooltip>
                ) : (
                  <>{snapshot?.type || `unknown`}</>
                )}
              </div>
              {snapshot?.type !== "standard" && (
                <a
                  role="button"
                  className="position-relative link-purple small"
                  onClick={() => {
                    setSnapshotType("standard");
                  }}
                >
                  View standard analysis
                </a>
              )}
            </div>
          ) : null}
          {showMoreMenu && (
            <div className="col-auto">
              <ResultMoreMenu
                experiment={experiment}
                differenceType={differenceType ?? "relative"}
                snapshotId={snapshot?.id || ""}
                datasource={datasource}
                forceRefresh={async () => {
                  await apiCall<{ snapshot: ExperimentSnapshotInterface }>(
                    `/experiment/${experiment.id}/snapshot?force=true`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        phase,
                        dimension,
                      }),
                    }
                  )
                    .then((res) => {
                      trackSnapshot(
                        "create",
                        "ForceRerunQueriesButton",
                        datasource?.type || null,
                        res.snapshot
                      );
                      mutate();
                    })
                    .catch((e) => {
                      console.error(e);
                    });
                }}
                editMetrics={editMetrics}
                notebookUrl={`/experiments/notebook/${snapshot?.id}`}
                notebookFilename={experiment.trackingKey}
                queries={snapshot?.queries}
                queryError={snapshot?.error}
                supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
                hasData={hasData}
                metrics={getAllMetricIdsFromExperiment(experiment, false)}
                results={analysis?.results}
                variations={variations}
                trackingKey={experiment.trackingKey}
                dimension={dimension}
                project={experiment.project}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isDifferent(
  val1?: string | boolean | number | null,
  val2?: string | boolean | number | null
) {
  if (!val1 && !val2) return false;
  return val1 !== val2;
}
function isDifferentStringArray(
  val1?: string[] | null,
  val2?: string[] | null
) {
  if (!val1 && !val2) return false;
  if (!val1 || !val2) return true;
  if (val1.length !== val2.length) return true;
  return val1.some((v) => !val2.includes(v));
}
function isStringArrayMissingElements(
  strings: string[] = [],
  elements: string[] = []
) {
  if (!elements.length) return false;
  if (elements.length > strings.length) return true;
  return elements.some((v) => !strings.includes(v));
}
function isDifferentDate(val1: Date, val2: Date, threshold: number = 86400000) {
  // 86400000 = 1 day
  return Math.abs(val1.getTime() - val2.getTime()) >= threshold;
}

export function isOutdated({
  experiment,
  snapshot,
  metricGroups = [],
  orgSettings,
  statsEngine,
  hasRegressionAdjustmentFeature,
  hasSequentialFeature,
  phase,
  unjoinableMetrics,
}: {
  experiment?: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  metricGroups?: MetricGroupInterface[];
  orgSettings: OrganizationSettings;
  statsEngine: StatsEngine;
  hasRegressionAdjustmentFeature: boolean;
  hasSequentialFeature: boolean;
  phase?: number;
  unjoinableMetrics?: Set<string>;
}): { outdated: boolean; reasons: string[] } {
  const snapshotSettings = snapshot?.settings;
  const analysisSettings = snapshot
    ? getSnapshotAnalysis(snapshot)?.settings
    : null;
  if (!experiment || !snapshotSettings || !analysisSettings) {
    return { outdated: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (
    isDifferent(
      analysisSettings.statsEngine || DEFAULT_STATS_ENGINE,
      statsEngine || DEFAULT_STATS_ENGINE
    )
  ) {
    reasons.push("Stats engine changed");
  }
  if (
    isDifferent(experiment.activationMetric, snapshotSettings.activationMetric)
  ) {
    reasons.push("Activation metric changed");
  }
  if (isDifferent(experiment.segment, snapshotSettings.segment)) {
    reasons.push("Segment changed");
  }
  if (isDifferent(experiment.queryFilter, snapshotSettings.queryFilter)) {
    reasons.push("Query filter changed");
  }
  if (
    isDifferent(experiment.skipPartialData, snapshotSettings.skipPartialData)
  ) {
    reasons.push("In-progress conversion behavior changed");
  }
  if (
    isDifferent(experiment.exposureQueryId, snapshotSettings.exposureQueryId)
  ) {
    reasons.push("Experiment assignment query changed");
  }
  if (
    isDifferent(
      experiment.attributionModel || "firstExposure",
      snapshotSettings.attributionModel || "firstExposure"
    )
  ) {
    reasons.push("Attribution model changed");
  }
  if (
    isStringArrayMissingElements(
      Array.from(
        new Set(
          expandMetricGroups(
            getAllMetricIdsFromExperiment(snapshotSettings, false),
            metricGroups
          )
        )
      ).filter((m) => (unjoinableMetrics ? !unjoinableMetrics.has(m) : true)),
      Array.from(
        new Set(
          expandMetricGroups(
            getAllMetricIdsFromExperiment(experiment, false),
            metricGroups
          )
        )
      ).filter((m) => (unjoinableMetrics ? !unjoinableMetrics.has(m) : true))
    )
  ) {
    reasons.push("Metrics changed");
  }
  if (
    isDifferentStringArray(
      experiment.variations.map((v) => v.key),
      snapshotSettings.variations.map((v) => v.id)
    )
  ) {
    reasons.push("Variations changed");
  }
  if (
    isDifferentDate(
      getValidDate(experiment.phases?.[phase ?? 0]?.dateStarted ?? ""),
      getValidDate(snapshotSettings.startDate)
    ) ||
    isDifferentDate(
      getValidDate(experiment.phases?.[phase ?? 0]?.dateEnded ?? ""),
      getValidDate(snapshotSettings.endDate)
    )
  ) {
    reasons.push("Analysis dates changed");
  }
  if (
    isDifferent(
      analysisSettings.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD,
      orgSettings.pValueThreshold || DEFAULT_P_VALUE_THRESHOLD
    )
  ) {
    reasons.push("P-value threshold changed");
  }

  const experimentRegressionAdjustmentEnabled = !hasRegressionAdjustmentFeature
    ? false
    : !!experiment.regressionAdjustmentEnabled;
  if (
    isDifferent(
      experimentRegressionAdjustmentEnabled,
      !!analysisSettings?.regressionAdjusted
    )
  ) {
    reasons.push("CUPED settings changed");
  }

  const experimentSequentialEnabled =
    statsEngine !== "frequentist" || !hasSequentialFeature
      ? false
      : experiment.sequentialTestingEnabled ??
        !!orgSettings.sequentialTestingEnabled;
  const experimentSequentialTuningParameter: number =
    experiment.sequentialTestingTuningParameter ??
    orgSettings.sequentialTestingTuningParameter ??
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  if (
    (isDifferent(
      experimentSequentialEnabled,
      !!analysisSettings?.sequentialTesting
    ) ||
      (experimentSequentialEnabled &&
        experimentSequentialTuningParameter !==
          analysisSettings?.sequentialTestingTuningParameter)) &&
    statsEngine === "frequentist"
  ) {
    reasons.push("Sequential testing settings changed");
  }

  return { outdated: reasons.length > 0, reasons };
}
