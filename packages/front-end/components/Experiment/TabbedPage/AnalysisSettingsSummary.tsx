import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FaChartBar,
  FaDatabase,
  FaExclamationTriangle,
  FaFlask,
  FaInfoCircle,
  FaTable,
} from "react-icons/fa";
import React, { ReactElement, useState } from "react";
import { GiPieChart } from "react-icons/gi";
import { HiCursorClick } from "react-icons/hi";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { ago, datetime } from "shared/dates";
import clsx from "clsx";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBEdit } from "@/components/Icons";
import ResultMoreMenu from "@/components/Experiment/ResultMoreMenu";
import { trackSnapshot } from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { isOutdated } from "@/components/Experiment/AnalysisSettingsBar";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import RefreshSnapshotButton from "@/components/Experiment/RefreshSnapshotButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import MetricName from "@/components/Metrics/MetricName";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import OverflowText from "./OverflowText";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  statsEngine: StatsEngine;
  editMetrics?: () => void;
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
  setDifferenceType: (differenceType: DifferenceType) => void;
}

export default function AnalysisSettingsSummary({
  experiment,
  mutate,
  statsEngine,
  editMetrics,
  setVariationFilter,
  baselineRow,
  setBaselineRow,
  setDifferenceType,
}: Props) {
  const {
    getDatasourceById,
    getSegmentById,
    getExperimentMetricById,
  } = useDefinitions();
  const orgSettings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const {
    snapshot,
    latest,
    analysis,
    dimension,
    mutateSnapshot,
    setAnalysisSettings,
    phase,
  } = useSnapshot();

  const canEditAnalysisSettings = permissionsUtil.canUpdateExperiment(
    experiment,
    {}
  );

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const [refreshError, setRefreshError] = useState("");

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;
  const phaseObj = experiment.phases?.[phase];
  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  const { apiCall } = useAuth();
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const [analysisModal, setAnalysisModal] = useState(false);

  const { outdated, reasons } = isOutdated(
    experiment,
    snapshot,
    orgSettings,
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase
  );

  const ds = getDatasourceById(experiment.datasource);
  const assignmentQuery = ds?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );
  const segment = getSegmentById(experiment.segment || "");

  const activationMetric = getExperimentMetricById(
    experiment.activationMetric || ""
  );

  const goals: string[] = [];
  experiment.metrics?.forEach((m) => {
    const name = getExperimentMetricById(m)?.name;
    if (name) goals.push(name);
  });
  const guardrails: string[] = [];
  experiment.guardrails?.forEach((m) => {
    const name = getExperimentMetricById(m)?.name;
    if (name) guardrails.push(name);
  });

  const numMetrics = goals.length + guardrails.length;

  const items: {
    value: string | number | ReactElement;
    tooltip?: string | ReactElement;
    icon?: ReactElement;
    noTransform?: boolean;
  }[] = [];

  items.push({
    value: ds ? ds.name : <em>no data source</em>,
    icon: <FaDatabase className="mr-1" />,
    tooltip: ds ? "Data Source" : "",
  });

  if (assignmentQuery) {
    items.push({
      value: assignmentQuery.name,
      icon: <FaTable className="mr-1" />,
      tooltip: "Experiment Assignment Query",
    });
  }
  if (ds) {
    items.push({
      value: experiment.trackingKey,
      icon: <FaFlask className="mr-1" />,
      tooltip: "Experiment Key",
    });
  }
  if (segment) {
    items.push({
      value: segment.name,
      icon: <GiPieChart className="mr-1" />,
      tooltip: "Segment",
    });
  }
  if (activationMetric) {
    items.push({
      value: <MetricName id={activationMetric.id} />,
      icon: <HiCursorClick className="mr-1" />,
      tooltip: "Activation Metric",
    });
  }

  items.push({
    value: numMetrics + " metrics",
    icon: <FaChartBar className="mr-1" />,
    noTransform: true,
    tooltip:
      numMetrics > 0 ? (
        <>
          <div className="mb-2 text-left">
            <strong>Goals:</strong>
            {goals.length > 0 ? (
              <ul className=" ml-0 pl-3 mb-0">
                {goals.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <em>none</em>
            )}
          </div>
          <div className="text-left">
            <strong>Guardrails:</strong>{" "}
            {guardrails.length > 0 ? (
              <ul className="ml-0 pl-3 mb-0">
                {guardrails.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <em>none</em>
            )}
          </div>
        </>
      ) : undefined,
  });

  return (
    <div className="px-3 py-2 bg-light border-bottom">
      {analysisModal && (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
        />
      )}
      <div className="row align-items-center text-muted">
        <div className="col-auto">
          {canEditAnalysisSettings ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setAnalysisModal(true);
              }}
            >
              <span className="text-dark">Analysis Settings</span> <GBEdit />
            </a>
          ) : (
            <span>Analysis Settings</span>
          )}
        </div>
        {items.map((item, i) => (
          <Tooltip
            body={
              item.tooltip && item.noTransform ? (
                <div>{item.tooltip}</div>
              ) : item.tooltip ? (
                <div className="text-center">
                  <strong>{item.tooltip}:</strong>
                  <div>{item.value}</div>
                </div>
              ) : (
                ""
              )
            }
            key={i}
          >
            <div
              key={i}
              className={`col-auto px-3 ${i > 0 ? "border-left" : ""}`}
            >
              <div style={{ cursor: "default" }}>
                {item.icon ? <>{item.icon} </> : null}
                {item.noTransform ? (
                  item.value
                ) : (
                  <OverflowText maxWidth={150}>{item.value}</OverflowText>
                )}
              </div>
            </div>
          </Tooltip>
        ))}
        <div className="flex-1" />

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
                className="text-muted text-right"
                style={{ maxWidth: 130, fontSize: "0.8em" }}
              >
                <div className="font-weight-bold" style={{ lineHeight: 1.2 }}>
                  last updated
                  {status === "partially-succeeded" && (
                    <Tooltip
                      body={
                        <span style={{ lineHeight: 1.5 }}>
                          Some of the queries had an error. The partial results
                          are displayed below.
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

        {(!ds || permissionsUtil.canRunExperimentQueries(ds)) &&
          experiment.metrics.length > 0 && (
            <div className="col-auto">
              {experiment.datasource && latest && latest.queries?.length > 0 ? (
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

                        setAnalysisSettings(null);
                        mutateSnapshot();
                        setRefreshError("");
                      })
                      .catch((e) => {
                        setRefreshError(e.message);
                      });
                  }}
                >
                  <RunQueriesButton
                    cta="Update"
                    cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                    mutate={mutateSnapshot}
                    model={latest}
                    icon="refresh"
                    color="outline-primary"
                    onSubmit={() => {
                      // todo: remove baseline resetter (here and below) once refactored.
                      if (baselineRow !== 0) {
                        setBaselineRow?.(0);
                        setVariationFilter?.([]);
                      }
                      setDifferenceType("relative");
                    }}
                  />
                </form>
              ) : (
                <RefreshSnapshotButton
                  mutate={mutateSnapshot}
                  phase={phase}
                  experiment={experiment}
                  lastAnalysis={analysis}
                  dimension={dimension}
                  setAnalysisSettings={setAnalysisSettings}
                  onSubmit={() => {
                    if (baselineRow !== 0) {
                      setBaselineRow?.(0);
                      setVariationFilter?.([]);
                    }
                    setDifferenceType("relative");
                  }}
                />
              )}
            </div>
          )}

        {ds &&
          permissionsUtil.canRunExperimentQueries(ds) &&
          latest &&
          (status === "failed" || status === "partially-succeeded") && (
            <div className="col-auto pl-1">
              <ViewAsyncQueriesButton
                queries={latest.queries.map((q) => q.query)}
                error={latest.error}
                color={clsx(
                  {
                    "outline-danger":
                      status === "failed" || status === "partially-succeeded",
                  },
                  " "
                )}
                display={null}
                status={status}
                icon={
                  <span className="position-relative pr-2">
                    <span className="text-main">
                      <FaDatabase />
                    </span>
                    <FaExclamationTriangle
                      className="position-absolute"
                      style={{
                        top: -6,
                        right: -4,
                      }}
                    />
                  </span>
                }
                condensed={true}
              />
            </div>
          )}

        <div className="col-auto px-0">
          <ResultMoreMenu
            id={snapshot?.id || ""}
            datasource={datasource}
            forceRefresh={
              experiment.metrics.length > 0 ||
              (experiment.guardrails?.length ?? 0) > 0
                ? async () => {
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
                        setAnalysisSettings(null);
                        if (baselineRow !== 0) {
                          setBaselineRow?.(0);
                          setVariationFilter?.([]);
                        }
                        setDifferenceType("relative");
                        trackSnapshot(
                          "create",
                          "ForceRerunQueriesButton",
                          datasource?.type || null,
                          res.snapshot
                        );
                        mutateSnapshot();
                      })
                      .catch((e) => {
                        console.error(e);
                      });
                  }
                : undefined
            }
            editMetrics={editMetrics}
            notebookUrl={`/experiments/notebook/${snapshot?.id}`}
            notebookFilename={experiment.trackingKey}
            generateReport={true}
            queries={
              latest && latest.status !== "error" && latest.queries
                ? latest.queries
                : snapshot?.queries
            }
            queryError={snapshot?.error}
            supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
            hasData={hasData}
            metrics={experiment.metrics}
            results={analysis?.results}
            variations={variations}
            trackingKey={experiment.trackingKey}
            dimension={dimension}
            project={experiment.project}
          />
        </div>
      </div>
      {refreshError && (
        <div className="alert alert-danger mt-2">
          <strong>Error updating data: </strong> {refreshError}
        </div>
      )}
    </div>
  );
}
