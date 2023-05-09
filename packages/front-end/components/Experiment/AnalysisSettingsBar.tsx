import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { useState } from "react";
import {
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { StatsEngine } from "back-end/types/stats";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import { OrganizationSettings } from "back-end/types/organization";
import {
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  ago,
  datetime,
} from "shared";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "@/components/Forms/Toggle";
import { GBCuped } from "@/components/Icons";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "@/components/Tooltip/Tooltip";
import RunQueriesButton, { getQueryStatus } from "../Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "../Queries/ViewAsyncQueriesButton";
import DimensionChooser from "../Dimensions/DimensionChooser";
import AnalysisForm from "./AnalysisForm";
import RefreshSnapshotButton from "./RefreshSnapshotButton";
import ResultMoreMenu from "./ResultMoreMenu";
import PhaseSelector from "./PhaseSelector";
import { useSnapshot } from "./SnapshotProvider";

function isDifferent(val1?: string | boolean, val2?: string | boolean) {
  if (!val1 && !val2) return false;
  return val1 !== val2;
}

function isOutdated(
  experiment: ExperimentInterfaceStringDates,
  snapshot: ExperimentSnapshotInterface,
  orgSettings: OrganizationSettings,
  statsEngine: StatsEngine,
  hasRegressionAdjustmentFeature: boolean,
  hasSequentialFeature: boolean
): { outdated: boolean; reason: string } {
  if (!snapshot) return { outdated: false, reason: "" };
  if (snapshot.statsEngine && isDifferent(snapshot.statsEngine, statsEngine)) {
    return { outdated: true, reason: "stats engine changed" };
  }
  if (isDifferent(snapshot.statsEngine, statsEngine)) {
    return { outdated: true, reason: "Stats engine changed" };
  }
  if (isDifferent(experiment.activationMetric, snapshot.activationMetric)) {
    return { outdated: true, reason: "Activation metric changed" };
  }
  if (isDifferent(experiment.segment, snapshot.segment)) {
    return { outdated: true, reason: "Segment changed" };
  }
  if (isDifferent(experiment.queryFilter, snapshot.queryFilter)) {
    return { outdated: true, reason: "Query filter changed" };
  }
  if (experiment.datasource && !("skipPartialData" in snapshot)) {
    return { outdated: true, reason: "Datasource changed" };
  }
  if (isDifferent(experiment.skipPartialData, snapshot.skipPartialData)) {
    return {
      outdated: true,
      reason: "In-progress conversion behavior changed",
    };
  }
  // todo: attribution model? (which doesn't live in the snapshot currently)

  const experimentRegressionAdjustmentEnabled =
    statsEngine !== "frequentist" || !hasRegressionAdjustmentFeature
      ? false
      : !!experiment.regressionAdjustmentEnabled;
  if (
    isDifferent(
      experimentRegressionAdjustmentEnabled,
      !!snapshot.regressionAdjustmentEnabled
    ) &&
    statsEngine === "frequentist"
  ) {
    return { outdated: true, reason: "CUPED settings changed" };
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
      !!snapshot.sequentialTestingEnabled
    ) ||
      (experimentSequentialEnabled &&
        experimentSequentialTuningParameter !==
          snapshot.sequentialTestingTuningParameter)) &&
    statsEngine === "frequentist"
  ) {
    return { outdated: true, reason: "Sequential testing settings changed" };
  }
  return { outdated: false, reason: "" };
}

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
}: {
  mutateExperiment: () => void;
  editMetrics?: () => void;
  editPhases?: () => void;
  variations: ExperimentReportVariation[];
  alwaysShowPhaseSelector?: boolean;
  statsEngine?: StatsEngine;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  onRegressionAdjustmentChange?: (enabled: boolean) => void;
}) {
  const {
    experiment,
    snapshot,
    latest,
    dimension,
    mutateSnapshot: mutate,
    phase,
    setDimension,
  } = useSnapshot();

  const { getDatasourceById } = useDefinitions();
  const orgSettings = useOrgSettings();
  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  const datasource = getDatasourceById(experiment.datasource);

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const { outdated, reason } = isOutdated(
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'ExperimentInterfaceStringDates |... Remove this comment to see the full error message
    experiment,
    snapshot,
    orgSettings,
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature
  );
  const [modalOpen, setModalOpen] = useState(false);

  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
  const hasData = snapshot?.results?.[0]?.variations?.length > 0;

  const [refreshError, setRefreshError] = useState("");

  return (
    <div>
      {modalOpen && (
        <AnalysisForm
          cancel={() => setModalOpen(false)}
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentInterfaceStringDates | undefined' ... Remove this comment to see the full error message
          experiment={experiment}
          mutate={mutateExperiment}
          phase={phase}
        />
      )}
      <div className="row align-items-center p-3">
        {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
        {experiment.phases &&
          // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
          (alwaysShowPhaseSelector || experiment.phases.length > 1) && (
            <div className="col-auto form-inline">
              <PhaseSelector
                mutateExperiment={mutateExperiment}
                editPhases={editPhases}
              />
            </div>
          )}
        <div className="col-auto form-inline">
          <DimensionChooser
            value={dimension}
            setValue={setDimension}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            activationMetric={!!experiment.activationMetric}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            datasourceId={experiment.datasource}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            exposureQueryId={experiment.exposureQueryId}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            userIdType={experiment.userIdType}
            labelClassName="mr-2"
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
                  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'boolean | undefined' is not assignable to ty... Remove this comment to see the full error message
                  value={regressionAdjustmentEnabled}
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
                          This experiment does not have any metrics suitable for
                          CUPED regression adjustment.
                        </p>
                        <p className="mb-0">
                          Please check your metric defintions, as well as any
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
              <Tooltip body={reason}>
                <div
                  className="badge badge-warning d-block py-1"
                  style={{ width: 100, marginBottom: 3 }}
                >
                  Out of Date <FaInfoCircle />
                </div>
              </Tooltip>
            ) : (
              <div
                className="text-muted text-right"
                style={{ width: 100, fontSize: "0.8em" }}
                // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                title={datetime(snapshot.dateCreated)}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                  last updated
                </div>
                <div className="d-inline-block" style={{ lineHeight: 1 }}>
                  {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                  {ago(snapshot.dateCreated)}
                </div>
              </div>
            ))}
        </div>
        {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
        {permissions.check("runQueries", "") && experiment.metrics.length > 0 && (
          <div className="col-auto">
            {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
            {experiment.datasource && latest && latest.queries?.length > 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  apiCall(`/experiment/${experiment.id}/snapshot`, {
                    method: "POST",
                    body: JSON.stringify({
                      phase,
                      dimension,
                      statsEngine,
                      regressionAdjustmentEnabled,
                      metricRegressionAdjustmentStatuses,
                    }),
                  })
                    .then(() => {
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
                  initialStatus={status}
                  statusEndpoint={`/snapshot/${latest.id}/status`}
                  cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                  onReady={() => {
                    mutate();
                  }}
                  icon="refresh"
                  color="outline-primary"
                />
              </form>
            ) : (
              <RefreshSnapshotButton
                mutate={mutate}
                phase={phase}
                // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ExperimentInterfaceStringDates | undefined' ... Remove this comment to see the full error message
                experiment={experiment}
                lastSnapshot={snapshot}
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
        <div className="col-auto">
          <ResultMoreMenu
            id={snapshot?.id || ""}
            forceRefresh={async () => {
              await apiCall(
                `/experiment/${
                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  experiment.id
                }/snapshot?force=true`,
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
                .then(() => {
                  mutate();
                })
                .catch((e) => {
                  console.error(e);
                });
            }}
            configure={() => setModalOpen(true)}
            editMetrics={editMetrics}
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            notebookFilename={experiment.trackingKey}
            generateReport={true}
            queries={snapshot?.queries}
            queryError={snapshot?.error}
            hasUserQuery={snapshot && !("skipPartialData" in snapshot)}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            metrics={experiment.metrics}
            results={snapshot?.results}
            variations={variations}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            trackingKey={experiment.trackingKey}
            dimension={dimension}
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            project={experiment.project}
          />
        </div>
      </div>
      {permissions.check("runQueries", "") && datasource && (
        <div className="px-3">
          {refreshError && (
            <div className="alert alert-danger">
              <strong>Error updating data: </strong> {refreshError}
            </div>
          )}
          <div className="row">
            {latest && status !== "succeeded" && (
              <div className="col-auto pb-3">
                <ViewAsyncQueriesButton
                  queries={latest.queries.map((q) => q.query)}
                  error={latest.error}
                  color={clsx(
                    {
                      danger: status === "failed",
                      info: status === "running",
                    },
                    " "
                  )}
                  display={
                    status === "failed"
                      ? "View Update Errors"
                      : "View Running Queries"
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
