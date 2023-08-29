import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import React, { useState } from "react";
import {
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { StatsEngine } from "back-end/types/stats";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaInfoCircle,
} from "react-icons/fa";
import { OrganizationSettings } from "back-end/types/organization";
import { ago, datetime, getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { getSnapshotAnalysis } from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "@/components/Forms/Toggle";
import { GBCuped } from "@/components/Icons";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "@/components/Tooltip/Tooltip";
import { trackSnapshot } from "@/services/track";
import VariationChooser from "@/components/Experiment/VariationChooser";
import BaselineChooser from "@/components/Experiment/BaselineChooser";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import DimensionChooser from "../Dimensions/DimensionChooser";
import AnalysisForm from "./AnalysisForm";
import RefreshSnapshotButton from "./RefreshSnapshotButton";
import ResultMoreMenu from "./ResultMoreMenu";
import PhaseSelector from "./PhaseSelector";
import { useSnapshot } from "./SnapshotProvider";

export default function AnalysisSettingsBar({
  mutateExperiment,
  editMetrics,
  editPhases,
  variations,
  alwaysShowPhaseSelector = false,
  statsEngine,
  regressionAdjustmentAvailable,
  regressionAdjustmentEnabled,
  regressionAdjustmentHasValidMetrics,
  metricRegressionAdjustmentStatuses,
  onRegressionAdjustmentChange,
  newUi = false,
  showCompactResults = false, // todo: remove once all results types support the new filters
  showMoreMenu = true,
  variationFilter,
  setVariationFilter,
  baselineRow,
  setBaselineRow,
}: {
  mutateExperiment: () => void;
  editMetrics?: () => void;
  editPhases?: () => void;
  variations: ExperimentReportVariation[];
  alwaysShowPhaseSelector?: boolean;
  statsEngine: StatsEngine;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  onRegressionAdjustmentChange?: (enabled: boolean) => void;
  newUi?: boolean;
  showCompactResults?: boolean;
  showMoreMenu?: boolean;
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
}) {
  const {
    experiment,
    snapshot,
    latest,
    analysis,
    dimension,
    mutateSnapshot: mutate,
    phase,
    setDimension,
  } = useSnapshot();
  const { getDatasourceById } = useDefinitions();
  const orgSettings = useOrgSettings();
  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const { outdated, reasons } = isOutdated(
    experiment,
    snapshot,
    orgSettings,
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase
  );

  const [modalOpen, setModalOpen] = useState(false);

  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const [refreshError, setRefreshError] = useState("");

  return (
    <div>
      {modalOpen && experiment && (
        <AnalysisForm
          cancel={() => setModalOpen(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={phase}
        />
      )}

      {experiment && (
        <div className="row align-items-center p-3">
          {!newUi &&
            experiment.phases &&
            (alwaysShowPhaseSelector || experiment.phases.length > 1) && (
              <div className="col-auto form-inline">
                <PhaseSelector
                  mutateExperiment={mutateExperiment}
                  editPhases={editPhases}
                />
              </div>
            )}
          {newUi &&
          showCompactResults &&
          setVariationFilter &&
          setBaselineRow ? (
            <>
              <div className="col-auto form-inline pr-5">
                <VariationChooser
                  variations={variations}
                  variationFilter={variationFilter ?? []}
                  setVariationFilter={setVariationFilter}
                  baselineRow={baselineRow ?? 0}
                />
                <em className="text-muted mx-2" style={{ marginTop: -4 }}>vs</em>
                <BaselineChooser
                  variations={variations}
                  variationFilter={variationFilter ?? []}
                  setVariationFilter={setVariationFilter}
                  baselineRow={baselineRow ?? 0}
                  setBaselineRow={setBaselineRow}
                />
              </div>
            </>
          ) : null}
          <div className="col-auto form-inline">
            <DimensionChooser
              value={dimension}
              setValue={setDimension}
              activationMetric={!!experiment.activationMetric}
              datasourceId={experiment.datasource}
              exposureQueryId={experiment.exposureQueryId}
              userIdType={experiment.userIdType}
              labelClassName="mr-2"
              newUi={newUi}
            />
          </div>
          <div style={{ flex: 1 }} />
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
                        onRegressionAdjustmentChange(value);
                      }
                    }}
                    className={`teal m-0`}
                    style={{ transform: "scale(0.8)" }}
                    disabled={!hasRegressionAdjustmentFeature}
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
                            Please check your metric definitions, as well as any
                            experiment-level metric overrides.
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
          <div className="col-auto">
            {hasData &&
              (outdated && status !== "running" ? (
                <Tooltip
                  body={
                    reasons.length === 1 ? (
                      reasons[0]
                    ) : reasons.length > 0 ? (
                      <ul className="ml-0 pl-3 mb-0">
                        {reasons.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      ""
                    )
                  }
                >
                  <div
                    className="badge badge-warning d-block py-1"
                    style={{ width: 100, marginBottom: 3 }}
                  >
                    Out of Date <FaInfoCircle />
                  </div>
                </Tooltip>
              ) : (
                <div
                  className="text-muted"
                  style={{ maxWidth: 130, fontSize: "0.8em" }}
                >
                  <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                    last updated
                    {status === "partially-succeeded" && (
                      <Tooltip
                        body={
                          <span style={{ lineHeight: 1.5 }}>
                            Some of the queries had an error. The partial
                            results are displayed below.
                          </span>
                        }
                      >
                        <FaExclamationTriangle
                          size={14}
                          className="text-danger ml-1"
                          style={{ marginTop: -4 }}
                        />
                      </Tooltip>
                    )}
                  </div>
                  <div className="d-flex align-items-center">
                    <div
                      style={{ lineHeight: 1 }}
                      title={datetime(snapshot?.dateCreated ?? "")}
                    >
                      {ago(snapshot?.dateCreated ?? "")}
                    </div>
                  </div>
                </div>
              ))}
          </div>
          {permissions.check("runQueries", experiment.project || "") &&
            experiment.metrics.length > 0 && (
              <div className="col-auto">
                {experiment.datasource &&
                latest &&
                latest.queries?.length > 0 ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      apiCall<{ snapshot: ExperimentSnapshotInterface }>(
                        `/experiment/${experiment.id}/snapshot`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            phase,
                            dimension,
                            statsEngine,
                            regressionAdjustmentEnabled,
                            metricRegressionAdjustmentStatuses,
                          }),
                        }
                      )
                        .then((res) => {
                          trackSnapshot(
                            "create",
                            "RunQueriesButton",
                            datasource?.type || null,
                            res.snapshot
                          );
                          mutate();
                          setRefreshError("");
                        })
                        .catch((e) => {
                          setRefreshError(e.message);
                        });
                    }}
                  >
                    <RunQueriesButton
                      cta="Update Data"
                      cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                      mutate={mutate}
                      model={latest}
                      icon="refresh"
                      color="outline-primary"
                    />
                  </form>
                ) : (
                  <RefreshSnapshotButton
                    mutate={mutate}
                    phase={phase}
                    experiment={experiment}
                    lastAnalysis={analysis}
                    dimension={dimension}
                    statsEngine={statsEngine}
                    regressionAdjustmentEnabled={regressionAdjustmentEnabled}
                    metricRegressionAdjustmentStatuses={
                      metricRegressionAdjustmentStatuses
                    }
                  />
                )}
              </div>
            )}
          {showMoreMenu && (
            <div className="col-auto">
              <ResultMoreMenu
                id={snapshot?.id || ""}
                forceRefresh={async () => {
                  await apiCall<{ snapshot: ExperimentSnapshotInterface }>(
                    `/experiment/${experiment.id}/snapshot?force=true`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        phase,
                        dimension,
                        statsEngine,
                        regressionAdjustmentEnabled,
                        metricRegressionAdjustmentStatuses,
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
                configure={() => setModalOpen(true)}
                editMetrics={editMetrics}
                notebookUrl={`/experiments/notebook/${snapshot?.id}`}
                notebookFilename={experiment.trackingKey}
                generateReport={true}
                queries={snapshot?.queries}
                queryError={snapshot?.error}
                supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
                hasData={hasData}
                metrics={experiment.metrics}
                results={analysis?.results}
                variations={variations}
                trackingKey={experiment.trackingKey}
                dimension={dimension}
                project={experiment.project}
                showPhaseSelector={
                  newUi &&
                  experiment.phases.length > 1 &&
                  (alwaysShowPhaseSelector || experiment.phases.length > 1)
                }
                mutateExperiment={mutateExperiment}
              />
            </div>
          )}
        </div>
      )}
      {permissions.check("runQueries", experiment?.project || "") &&
        datasource && (
          <div className="px-3">
            {refreshError && (
              <div className="alert alert-danger">
                <strong>Error updating data: </strong> {refreshError}
              </div>
            )}
            {latest &&
              (status === "running" ||
                status === "failed" ||
                status === "partially-succeeded") && (
                <div className="row">
                  <div className="flex-1" />
                  <div className="col-auto pb-1">
                    <ViewAsyncQueriesButton
                      queries={latest.queries.map((q) => q.query)}
                      error={latest.error}
                      color={clsx(
                        {
                          danger:
                            status === "failed" ||
                            status === "partially-succeeded",
                          info: status === "running",
                        },
                        " "
                      )}
                      display={
                        status === "failed" || status === "partially-succeeded"
                          ? "View Update Errors"
                          : "View Running Queries"
                      }
                    />
                  </div>
                </div>
              )}
          </div>
        )}
    </div>
  );
}

function isDifferent(
  val1?: string | boolean | null,
  val2?: string | boolean | null
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
function isDifferentDate(val1: Date, val2: Date, threshold: number = 86400000) {
  // 86400000 = 1 day
  return Math.abs(val1.getTime() - val2.getTime()) >= threshold;
}

function isOutdated(
  experiment: ExperimentInterfaceStringDates | undefined,
  snapshot: ExperimentSnapshotInterface | undefined,
  orgSettings: OrganizationSettings,
  statsEngine: StatsEngine,
  hasRegressionAdjustmentFeature: boolean,
  hasSequentialFeature: boolean,
  phase: number | undefined
): { outdated: boolean; reasons: string[] } {
  const snapshotSettings = snapshot?.settings;
  const analysisSettings = snapshot
    ? getSnapshotAnalysis(snapshot)?.settings
    : null;
  if (!experiment || !snapshotSettings || !analysisSettings) {
    return { outdated: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (isDifferent(analysisSettings.statsEngine, statsEngine)) {
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
    isDifferent(experiment.attributionModel, snapshotSettings.attributionModel)
  ) {
    reasons.push("Attribution model changed");
  }
  if (isDifferent(experiment.queryFilter, snapshotSettings.queryFilter)) {
    reasons.push("Query filter changed");
  }
  if (
    isDifferentStringArray(
      [...experiment.metrics, ...(experiment?.guardrails || [])],
      [...snapshotSettings.goalMetrics, ...snapshotSettings.guardrailMetrics]
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

  const experimentRegressionAdjustmentEnabled =
    statsEngine !== "frequentist" || !hasRegressionAdjustmentFeature
      ? false
      : !!experiment.regressionAdjustmentEnabled;
  if (
    isDifferent(
      experimentRegressionAdjustmentEnabled,
      !!analysisSettings?.regressionAdjusted
    ) &&
    statsEngine === "frequentist"
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
