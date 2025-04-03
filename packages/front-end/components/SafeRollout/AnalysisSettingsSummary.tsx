import {
  FaChartBar,
  FaDatabase,
  FaExclamationTriangle,
  FaFlask,
  FaTable,
} from "react-icons/fa";
import React, { ReactElement, useMemo, useState } from "react";
import clsx from "clsx";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  isFactMetric,
  isMetricJoinable,
} from "shared/experiments";
import { SafeRolloutRule } from "back-end/src/validators/features";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { trackSnapshot } from "@/services/track";
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import OverflowText from "../Experiment/TabbedPage/OverflowText";
import { useSnapshot } from "./SnapshotProvider";

export interface Props {
  safeRollout: SafeRolloutRule;
  mutate: () => void;
}

export default function AnalysisSettingsSummary({
  safeRollout,
  mutate,
}: Props) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    factTables,
    metricGroups,
  } = useDefinitions();

  const datasourceSettings = safeRollout.datasource
    ? getDatasourceById(safeRollout.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId
  )?.userIdType;

  const orgSettings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialFeature = hasCommercialFeature("sequential-testing");

  const {
    snapshot,
    feature,
    latest,
    analysis,
    dimension,
    mutateSnapshot,
  } = useSnapshot();

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const [refreshError, setRefreshError] = useState("");

  const { apiCall } = useAuth();
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const allExpandedMetrics = Array.from(
    new Set(
      expandMetricGroups(
        getAllMetricIdsFromExperiment(safeRollout, false),
        metricGroups
      )
    )
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

  // TODO: create isOutdated function for safe rollouts
  const { outdated, reasons } = isOutdated({
    safeRollout,
    snapshot,
    metricGroups,
    orgSettings,
    statsEngine: "frequentist",
    hasRegressionAdjustmentFeature,
    hasSequentialFeature,
    phase: 0,
    unjoinableMetrics,
  });

  const ds = getDatasourceById(safeRollout.datasource);
  const assignmentQuery = ds?.settings?.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId
  );

  const guardrails: string[] = [];
  expandMetricGroups(safeRollout.guardrailMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) guardrails.push(name);
    }
  );

  const numMetrics = guardrails.length;

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
      value: safeRollout.trackingKey,
      icon: <FaFlask className="mr-1" />,
      tooltip: "Tracking Key",
    });
  }

  items.push({
    value: numMetrics + (numMetrics === 1 ? " metric" : " metrics"),
    icon: <FaChartBar className="mr-1" />,
    noTransform: true,
    tooltip:
      numMetrics > 0 ? (
        <>
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
        </>
      ) : undefined,
  });

  return (
    <div className="pr-3 py-2 analysis-settings-top border-bottom">
      <div className="row align-items-center justify-content-end">
        <div className="col-auto">
          <div className="row align-items-center text-muted">
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
                  {safeRollout.datasource &&
                  feature &&
                  latest &&
                  latest.queries?.length > 0 ? (
                    <RunQueriesButton
                      cta="Update"
                      cancelEndpoint={`safe-rollout/snapshot/${latest.id}/cancel`}
                      mutate={() => {
                        mutateSnapshot();
                        mutate();
                      }}
                      model={latest}
                      icon="refresh"
                      color="outline-primary"
                      onSubmit={async () => {
                        await apiCall<{
                          snapshot: SafeRolloutSnapshotInterface;
                        }>(`/safe-rollout/${safeRollout.id}/snapshot`, {
                          method: "POST",
                          body: JSON.stringify({
                            featureId: feature.id,
                          }),
                        })
                          .then((res) => {
                            // trackSnapshot(
                            //   "create",
                            //   "RunQueriesButton",
                            //   datasource?.type || null,
                            //   res.snapshot
                            // );

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
                      phase={0}
                      experiment={safeRollout}
                      lastAnalysis={analysis}
                      dimension={dimension}
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
                    error={latest.error ?? undefined}
                    color={clsx(
                      {
                        "outline-danger":
                          status === "failed" ||
                          status === "partially-succeeded",
                      },
                      " "
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

            <div className="col-auto px-0"></div>
          </div>
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
