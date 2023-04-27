import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import clsx from "clsx";
import { useState } from "react";
import {
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { StatsEngine } from "back-end/types/stats";
import { FaInfoCircle } from "react-icons/fa";
import { OrganizationSettings } from "back-end/types/organization";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared";
import { useAuth } from "@/services/auth";
import { ago, datetime } from "@/services/dates";
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
  if (isDifferent(experiment.activationMetric, snapshot.activationMetric)) {
    return { outdated: true, reason: "activation metric changed" };
  }
  if (isDifferent(experiment.segment, snapshot.segment)) {
    return { outdated: true, reason: "segment changed" };
  }
  if (isDifferent(experiment.queryFilter, snapshot.queryFilter)) {
    return { outdated: true, reason: "query filter changed" };
  }
  if (experiment.datasource && !("skipPartialData" in snapshot)) {
    return { outdated: true, reason: "datasource changed" };
  }
  if (isDifferent(experiment.skipPartialData, snapshot.skipPartialData)) {
    return {
      outdated: true,
      reason: "in-progress conversion behavior changed",
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
    )
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
    isDifferent(
      experimentSequentialEnabled,
      !!snapshot.sequentialTestingEnabled
    ) ||
    (experimentSequentialEnabled &&
      experimentSequentialTuningParameter !==
        snapshot.sequentialTestingTuningParameter)
  ) {
    return { outdated: true, reason: "sequential testing settings changed" };
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
  const settings = useOrgSettings();
  const datasource = getDatasourceById(experiment.datasource);

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const { outdated, reason } = isOutdated(
    experiment,
    snapshot,
    settings,
    settings.statsEngine || "bayesian",
    hasRegressionAdjustmentFeature,
    hasSequentialFeature
  );
  const [modalOpen, setModalOpen] = useState(false);

  const permissions = usePermissions();

  const { apiCall } = useAuth();

  const status = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = snapshot?.results?.[0]?.variations?.length > 0;

  const [refreshError, setRefreshError] = useState("");

  return (
    <div>
      {modalOpen && (
        <AnalysisForm
          cancel={() => setModalOpen(false)}
          experiment={experiment}
          mutate={mutateExperiment}
          phase={phase}
        />
      )}
      <div className="row align-items-center p-3">
        {experiment.phases &&
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
            activationMetric={!!experiment.activationMetric}
            datasourceId={experiment.datasource}
            exposureQueryId={experiment.exposureQueryId}
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
                title={datetime(snapshot.dateCreated)}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.5 }}>
                  last updated
                </div>
                <div className="d-inline-block" style={{ lineHeight: 1 }}>
                  {ago(snapshot.dateCreated)}
                </div>
              </div>
            ))}
        </div>
        {permissions.check("runQueries", "") && experiment.metrics.length > 0 && (
          <div className="col-auto">
            {experiment.datasource && latest && latest.queries?.length > 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
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
            notebookFilename={experiment.trackingKey}
            generateReport={true}
            queries={snapshot?.queries}
            queryError={snapshot?.error}
            hasUserQuery={snapshot && !("skipPartialData" in snapshot)}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            metrics={experiment.metrics}
            results={snapshot?.results}
            variations={variations}
            trackingKey={experiment.trackingKey}
            dimension={dimension}
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
