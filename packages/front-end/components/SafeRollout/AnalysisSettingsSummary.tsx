import { FaDatabase, FaExclamationTriangle } from "react-icons/fa";
import React, { ReactElement, useState } from "react";
import clsx from "clsx";
import { expandMetricGroups } from "shared/experiments";
import { SafeRolloutInterface } from "shared/src/validators/safe-rollout";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout-snapshot";
import { differenceInHours } from "date-fns";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import OutdatedBadge from "@/components/OutdatedBadge";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Metadata from "@/ui/Metadata";
import OverflowText from "../Experiment/TabbedPage/OverflowText";
import RefreshSnapshotButton from "./RefreshSnapshotButton";

const numberFormatter = Intl.NumberFormat();
export interface Props {
  safeRollout: SafeRolloutInterface;
}

export default function SafeRolloutAnalysisSettingsSummary({
  safeRollout,
}: Props) {
  const { getDatasourceById, getExperimentMetricById, metricGroups } =
    useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const { snapshot, feature, latest, analysis, mutateSnapshot } =
    useSafeRolloutSnapshot();

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const [refreshError, setRefreshError] = useState("");

  const { apiCall } = useAuth();
  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const showQueryWarning =
    status === "failed" || status === "partially-succeeded";

  // Results are considered outdated if there isn't currently a running snapshot and
  // the last snapshot was taken more than 24 hours ago
  const outdated =
    snapshot?.runStarted &&
    differenceInHours(Date.now(), new Date(snapshot.runStarted)) > 24.5;

  const ds = getDatasourceById(safeRollout.datasourceId);

  const guardrails: string[] = [];
  expandMetricGroups(
    safeRollout.guardrailMetricIds ?? [],
    metricGroups,
  ).forEach((m) => {
    const name = getExperimentMetricById(m)?.name;
    if (name) guardrails.push(name);
  });

  const numMetrics = guardrails.length;

  const items: {
    value: string | number | ReactElement;
    tooltip?: string | ReactElement;
    icon?: ReactElement;
    noTransform?: boolean;
  }[] = [];

  return (
    <div className="pr-2 pl-4 pt-3 pb-2 analysis-settings-top">
      <div className="row align-items-center justify-content-between">
        <div className="col-auto">
          <h4>Guardrail Metrics</h4>
          <div>
            <Metadata
              label="Total units"
              value={numberFormatter.format(
                safeRollout.analysisSummary?.health?.totalUsers ?? 0,
              )}
            />
          </div>
        </div>
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
                  <OutdatedBadge reasons={["Snapshot is over a day old."]} />
                ) : (
                  <QueriesLastRun
                    status={status}
                    dateCreated={snapshot?.dateCreated}
                  />
                ))}
            </div>

            {(!ds || permissionsUtil.canRunExperimentQueries(ds)) &&
              numMetrics > 0 &&
              feature && (
                <div className="col-auto">
                  {safeRollout.datasourceId &&
                  latest &&
                  latest.queries?.length > 0 ? (
                    <RunQueriesButton
                      cta="Update"
                      cancelEndpoint={`/safe-rollout/snapshot/${latest.id}/cancel`}
                      mutate={() => {
                        mutateSnapshot();
                      }}
                      model={latest}
                      icon="refresh"
                      onSubmit={async () => {
                        await apiCall<{
                          snapshot: SafeRolloutSnapshotInterface;
                        }>(`/safe-rollout/${safeRollout.id}/snapshot`, {
                          method: "POST",
                        })
                          .then(() => {
                            mutateSnapshot();
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
                      }}
                      safeRollout={safeRollout}
                    />
                  )}
                </div>
              )}

            {ds && permissionsUtil.canRunExperimentQueries(ds) && latest && (
              <div className="col-auto pl-1">
                <ViewAsyncQueriesButton
                  queries={latest.queries.map((q) => q.query)}
                  error={latest.error ?? undefined}
                  color={clsx(
                    {
                      "outline-danger": showQueryWarning,
                    },
                    " ",
                  )}
                  display={null}
                  status={status}
                  icon={
                    <span
                      className="position-relative pr-2"
                      style={{ marginRight: showQueryWarning ? 6 : 0 }}
                    >
                      <span className="text-main">
                        <FaDatabase />
                      </span>
                      {showQueryWarning && (
                        <FaExclamationTriangle
                          className="position-absolute"
                          style={{
                            top: -6,
                            right: -4,
                          }}
                        />
                      )}
                    </span>
                  }
                  condensed={true}
                  hideQueryCount={status !== "failed"}
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
