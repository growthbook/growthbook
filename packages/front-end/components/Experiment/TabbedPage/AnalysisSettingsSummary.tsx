import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FaChartBar,
  FaDatabase,
  FaExclamationTriangle,
  FaFlask,
  FaTable,
} from "react-icons/fa";
import React, { ReactElement, useMemo, useState } from "react";
import { GiPieChart } from "react-icons/gi";
import { HiCursorClick } from "react-icons/hi";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import clsx from "clsx";
import { Box, Text } from "@radix-ui/themes";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getAllExpandedMetricIdsFromExperiment,
  isFactMetric,
  isMetricJoinable,
  expandAllSliceMetricsInMap,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ExperimentSnapshotReportArgs } from "back-end/types/report";
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
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import OutdatedBadge from "@/components/OutdatedBadge";
import MetricName from "@/components/Metrics/MetricName";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import Callout from "@/ui/Callout";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import OverflowText from "./OverflowText";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate: () => void;
  statsEngine: StatsEngine;
  editMetrics?: () => void;
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
  setDifferenceType: (differenceType: DifferenceType) => void;
  reportArgs?: ExperimentSnapshotReportArgs;
}

export default function AnalysisSettingsSummary({
  experiment,
  envs,
  mutate,
  statsEngine,
  editMetrics,
  baselineRow,
  setVariationFilter,
  setBaselineRow,
  setDifferenceType,
  reportArgs,
}: Props) {
  const {
    getDatasourceById,
    getSegmentById,
    getExperimentMetricById,
    factTables,
    metricGroups,
    factMetrics,
    metrics,
    mutateDefinitions,
  } = useDefinitions();

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  )?.userIdType;

  const orgSettings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const {
    snapshot,
    latest,
    analysis,
    dimension,
    mutateSnapshot,
    setAnalysisSettings,
    setSnapshotType,
    phase,
  } = useSnapshot();

  const { mutateDashboards } = useExperimentDashboards(experiment.id);

  const canEditAnalysisSettings = permissionsUtil.canUpdateExperiment(
    experiment,
    {},
  );

  const isBandit = experiment.type === "multi-armed-bandit";

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

  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
    );

  const handleDisableIncrementalRefresh = async () => {
    if (!datasource || !isExperimentIncludedInIncrementalRefresh) return;

    await apiCall(`/datasource/${datasource.id}`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          ...datasource.settings,
          pipelineSettings: {
            ...datasource.settings.pipelineSettings,
            excludedExperimentIds: [
              ...(datasource.settings?.pipelineSettings
                ?.excludedExperimentIds ?? []),
              experiment.id,
            ],
          },
        },
      }),
    });
    setRefreshError("");
    mutateDefinitions();
  };

  const allExpandedMetrics = Array.from(
    new Set(
      expandMetricGroups(
        getAllMetricIdsFromExperiment(experiment, false, metricGroups),
        metricGroups,
      ),
    ),
  );

  const unjoinableMetrics = useMemo(() => {
    const unjoinables = new Set<string>();
    allExpandedMetrics.forEach((m) => {
      const metric = getExperimentMetricById(m);
      if (!metric) return;
      const userIdTypes = isFactMetric(metric)
        ? factTables.find((f) => f.id === metric.numerator.factTableId)
            ?.userIdTypes || []
        : metric.userIdTypes || [];
      const isJoinable =
        userIdType && datasourceSettings
          ? isMetricJoinable(userIdTypes, userIdType, datasourceSettings)
          : true;
      if (!isJoinable) {
        unjoinables.add(m);
      }
    });
    return unjoinables;
  }, [
    allExpandedMetrics,
    factTables,
    userIdType,
    datasourceSettings,
    getExperimentMetricById,
  ]);

  const conversionWindowMetrics = useMemo(() => {
    const conversionWindowMetrics = new Set<string>();
    allExpandedMetrics.forEach((m) => {
      const metric = getExperimentMetricById(m);
      if (!metric) return;
      if (metric?.windowSettings?.type === "conversion") {
        conversionWindowMetrics.add(m);
      }
    });
    return conversionWindowMetrics;
  }, [allExpandedMetrics, getExperimentMetricById]);

  const { outdated, reasons } = isOutdated({
    experiment,
    snapshot,
    metricGroups,
    orgSettings,
    statsEngine,
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase,
    unjoinableMetrics,
    conversionWindowMetrics,
  });

  const ds = getDatasourceById(experiment.datasource);
  const assignmentQuery = ds?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const segment = getSegmentById(experiment.segment || "");

  const activationMetric = getExperimentMetricById(
    experiment.activationMetric || "",
  );

  const goals: string[] = [];
  expandMetricGroups(experiment.goalMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) goals.push(name);
    },
  );
  const secondary: string[] = [];
  expandMetricGroups(experiment.secondaryMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) secondary.push(name);
    },
  );
  const guardrails: string[] = [];
  expandMetricGroups(experiment.guardrailMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) guardrails.push(name);
    },
  );

  const numMetrics = goals.length + secondary.length + guardrails.length;

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

  if (assignmentQuery && ds?.type !== "mixpanel") {
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
      tooltip: "Tracking Key",
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
    value: numMetrics + (numMetrics === 1 ? " metric" : " metrics"),
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
              <>
                {" "}
                <em>none</em>
              </>
            )}
          </div>
          <div className="mb-2 text-left">
            <strong>Secondary Metrics:</strong>
            {secondary.length > 0 ? (
              <ul className=" ml-0 pl-3 mb-0">
                {secondary.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <>
                {" "}
                <em>none</em>
              </>
            )}
          </div>
          {experiment.type !== "holdout" ? (
            <div className="text-left">
              <strong>Guardrails:</strong>
              {guardrails.length > 0 ? (
                <ul className="ml-0 pl-3 mb-0">
                  {guardrails.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              ) : (
                <>
                  {" "}
                  <em>none</em>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : undefined,
  });

  return (
    <div className="px-3 py-2 analysis-settings-top border-bottom">
      {analysisModal && (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          envs={envs}
          experiment={experiment}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
          source={"analysis-settings-summary"}
        />
      )}
      <div className="row align-items-center justify-content-end">
        <div className="col-auto">
          <div className="row align-items-center text-muted">
            <div className="col-auto">
              {!(isBandit && experiment.status === "running") &&
              canEditAnalysisSettings ? (
                <div className="cursor-pointer">
                  <Link
                    onClick={(e) => {
                      e.preventDefault();
                      setAnalysisModal(true);
                    }}
                  >
                    <span className="text-dark">Analysis Settings</span>
                    <GBEdit className="ml-2" />
                  </Link>
                </div>
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
          </div>
        </div>
        <div className="col flex-1" />
        <div className="col-auto">
          <div className="row align-items-center justify-content-end">
            <div className="col-auto">
              {hasData &&
                (outdated && status !== "running" ? (
                  <OutdatedBadge reasons={reasons} />
                ) : (
                  <QueriesLastRun
                    status={status}
                    dateCreated={snapshot?.dateCreated}
                  />
                ))}
            </div>

            {(!ds || permissionsUtil.canRunExperimentQueries(ds)) &&
              numMetrics > 0 && (
                <div className="col-auto">
                  {experiment.datasource &&
                  latest &&
                  latest.queries?.length > 0 ? (
                    <RunQueriesButton
                      cta="Update"
                      cancelEndpoint={`/snapshot/${latest.id}/cancel`}
                      mutate={() => {
                        mutateSnapshot();
                        mutate();
                        mutateDashboards();
                      }}
                      model={latest}
                      icon="refresh"
                      color="outline-primary"
                      resetFilters={async () => {
                        // todo: remove baseline resetter (here and below) once refactored.
                        if (baselineRow !== 0) {
                          setBaselineRow?.(0);
                          setVariationFilter?.([]);
                        }
                        setDifferenceType("relative");
                        experiment.type === "multi-armed-bandit"
                          ? setSnapshotType("exploratory")
                          : setSnapshotType(undefined);
                      }}
                      onSubmit={async () => {
                        await apiCall<{
                          snapshot: ExperimentSnapshotInterface;
                        }>(`/experiment/${experiment.id}/snapshot`, {
                          method: "POST",
                          body: JSON.stringify({
                            phase,
                            dimension,
                          }),
                        })
                          .then((res) => {
                            trackSnapshot(
                              "create",
                              "RunQueriesButton",
                              datasource?.type || null,
                              res.snapshot,
                            );

                            setAnalysisSettings(null);
                            mutateSnapshot();
                            mutate();
                            setRefreshError("");
                          })
                          .catch((e) => {
                            setRefreshError(e.message);
                          });
                      }}
                    />
                  ) : (
                    <RefreshSnapshotButton
                      mutate={() => {
                        mutateSnapshot();
                        mutate();
                      }}
                      phase={phase}
                      experiment={experiment}
                      lastAnalysis={analysis}
                      dimension={dimension}
                      setError={(error) => setRefreshError(error ?? "")}
                      setAnalysisSettings={setAnalysisSettings}
                      resetFilters={() => {
                        if (baselineRow !== 0) {
                          setBaselineRow?.(0);
                          setVariationFilter?.([]);
                        }
                        setDifferenceType("relative");
                        experiment.type === "multi-armed-bandit"
                          ? setSnapshotType("exploratory")
                          : setSnapshotType(undefined);
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
                          status === "failed" ||
                          status === "partially-succeeded",
                      },
                      " ",
                    )}
                    display={null}
                    status={status}
                    icon={
                      <span
                        className="position-relative pr-2"
                        style={{ marginRight: 6 }}
                      >
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
                experiment={experiment}
                snapshotId={snapshot?.id || ""}
                datasource={datasource}
                forceRefresh={
                  numMetrics > 0
                    ? async () => {
                        await apiCall<{
                          snapshot: ExperimentSnapshotInterface;
                        }>(`/experiment/${experiment.id}/snapshot?force=true`, {
                          method: "POST",
                          body: JSON.stringify({
                            phase,
                            dimension,
                          }),
                        })
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
                              res.snapshot,
                            );
                            mutateSnapshot();
                            mutate();
                            setRefreshError("");
                          })
                          .catch((e) => {
                            console.error(e);
                            setRefreshError(e.message);
                          });
                      }
                    : undefined
                }
                editMetrics={editMetrics}
                notebookUrl={`/experiments/notebook/${snapshot?.id}`}
                notebookFilename={experiment.trackingKey}
                reportArgs={reportArgs}
                queries={
                  latest && latest.status !== "error" && latest.queries
                    ? latest.queries
                    : snapshot?.queries
                }
                queryError={snapshot?.error}
                supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
                hasData={hasData}
                metrics={useMemo(() => {
                  const metricMap = new Map<
                    string,
                    ExperimentMetricInterface
                  >();
                  const allBaseMetrics = [...metrics, ...factMetrics];
                  allBaseMetrics.forEach((metric) =>
                    metricMap.set(metric.id, metric),
                  );
                  const factTableMap = new Map(
                    factTables.map((table) => [table.id, table]),
                  );

                  // Expand slice metrics and add them to the map
                  expandAllSliceMetricsInMap({
                    metricMap,
                    factTableMap,
                    experiment,
                    metricGroups,
                  });

                  return getAllExpandedMetricIdsFromExperiment({
                    exp: experiment,
                    expandedMetricMap: metricMap,
                    includeActivationMetric: false,
                    metricGroups,
                  });
                }, [
                  experiment,
                  metrics,
                  factMetrics,
                  factTables,
                  metricGroups,
                ])}
                results={analysis?.results}
                variations={variations}
                trackingKey={experiment.trackingKey}
                dimension={dimension}
                project={experiment.project}
              />
            </div>
          </div>
        </div>
      </div>
      {refreshError && (
        <>
          <Callout status="error" mt="2">
            <strong>Error updating data: </strong> {refreshError}
          </Callout>
          {isExperimentIncludedInIncrementalRefresh && (
            <Box mt="2" mb="2" style={{ color: "var(--color-text-low)" }}>
              <Text size="1">
                If this error persists, you can try disabling Incremental
                Refresh for this experiment by{" "}
                <Link onClick={handleDisableIncrementalRefresh}>
                  clicking here
                </Link>
                .
              </Text>
            </Box>
          )}
        </>
      )}
    </div>
  );
}
