import { ReactNode, useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentReportVariation } from "shared/types/report";
import { datetimeAt } from "shared/dates";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { IssueTags } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { useContextualBanditHealthIssues } from "@/hooks/useContextualBandits";
import { useContextualBanditSnapshot } from "@/components/ContextualBandit/ContextualBanditSnapshotProvider";
import StatusErrorCallout from "@/components/ContextualBandit/StatusErrorCallout";
import ContextualBanditSRMCard from "./ContextualBanditSRMCard";

export default function ContextualBanditHealthTab({
  cb,
}: {
  cb: ApiContextualBanditInterface;
}) {
  const {
    results,
    latest,
    loading,
    error,
    statusError,
    mutate,
    refreshStatus,
  } = useContextualBanditSnapshot();
  const healthIssues = useContextualBanditHealthIssues(cb);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const health = results?.health ?? null;

  const variations: ExperimentReportVariation[] = useMemo(
    () =>
      (health?.variations ?? []).map((v, i) => ({
        id: v.variationId,
        index: i,
        name: v.variationName ?? v.variationId,
        weight: v.weight,
      })),
    [health],
  );

  const traffic = health?.traffic ?? null;
  const overallUsers = useMemo(
    () => variations.map((_, i) => traffic?.overall?.variationUnits?.[i] ?? 0),
    [variations, traffic],
  );
  const totalUsers = overallUsers.reduce((sum, n) => sum + n, 0);

  // The results tab and this tab show the same run. A newer snapshot may be
  // in flight or have failed; `latest` tells us which.
  const newerRun = latest && latest.id !== results?.snapshotId ? latest : null;
  const resultsDateClause = results
    ? ` on ${datetimeAt(results.dateCreated)}`
    : "";

  if (loading) {
    return (
      <Callout status="info" mt="3" icon={<LoadingSpinner />}>
        Snapshot refreshing, health data loading...
      </Callout>
    );
  }

  if (error) {
    return (
      <Callout status="error" mt="3">
        {error.message}
      </Callout>
    );
  }

  const statusErrorCallout = statusError ? (
    <StatusErrorCallout error={statusError} onRetry={() => mutate()} />
  ) : null;

  let body: ReactNode;
  if (!results) {
    body = (
      <Callout status="info">
        No updates yet. Traffic and health results will appear after a
        successful refresh of the results.
      </Callout>
    );
  } else if (!traffic) {
    body = (
      <Callout status="info">
        Traffic data will appear after a successful results refresh.
      </Callout>
    );
  } else if (traffic.error && traffic.error !== "NO_ROWS_IN_UNIT_QUERY") {
    body = (
      <Callout status="error">
        There was an error running the traffic query for the Health tab:{" "}
        {traffic.error}.
      </Callout>
    );
  } else if (totalUsers === 0) {
    body = (
      <Callout status="info">
        No data found. It is likely there are no units in your Bandit yet.
      </Callout>
    );
  } else {
    body = (
      <>
        {newerRun?.status === "error" ? (
          <Callout status="warning" mb="3">
            The most recent refresh failed, so the health results below are from
            the last successful refresh{resultsDateClause}.
            {newerRun.error ? ` Error: ${newerRun.error}` : ""}
          </Callout>
        ) : newerRun?.status === "running" ? (
          <Callout status="info" mb="3">
            A refresh is in progress. The health results below are from the last
            successful refresh{resultsDateClause}.
          </Callout>
        ) : null}

        <IssueTags issues={healthIssues} />

        <TrafficCard
          traffic={traffic}
          variations={variations}
          isBandit
          disableDimensions
          overTimeTitle="Traffic Over Time"
        />

        {health?.multipleExposures === null ? (
          <Callout status="info" mt="4">
            Balance and multiple exposure checks need the bandit_version,
            leaf_id, and variation_weights columns in your assignment query.
          </Callout>
        ) : (
          <>
            <div id="balanceCheck" style={{ scrollMarginTop: "100px" }}>
              <ContextualBanditSRMCard
                srm={health?.srm?.pValue ?? null}
                variations={variations}
                users={overallUsers}
                totalUsers={totalUsers}
                latestPeriod={health?.srm?.latestPeriod ?? null}
              />
            </div>

            <div id="multipleExposures" style={{ scrollMarginTop: "100px" }}>
              <MultipleExposuresCard
                totalUsers={totalUsers}
                multipleExposures={health?.multipleExposures ?? 0}
                isBandit
              />
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <Flex direction="column" mt="3">
      {statusErrorCallout}
      {body}
    </Flex>
  );
}
