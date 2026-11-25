import { ReactNode, useEffect, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { SCROLL_MARGIN_UNDER_TABS } from "@/components/Layout/constants";
import ContextualBanditSRMCard from "./ContextualBanditSRMCard";

export default function ContextualBanditHealthTab({
  cb,
}: {
  cb: ApiContextualBanditInterface;
}) {
  const { t } = useLingui();
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

  if (loading) {
    return (
      <Callout status="info" mt="3" icon={<LoadingSpinner />}>
        <Trans>Snapshot refreshing, health data loading...</Trans>
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
        <Trans>
          No updates yet. Traffic and health results will appear after a
          successful refresh of the results.
        </Trans>
      </Callout>
    );
  } else if (!traffic) {
    body = (
      <Callout status="info">
        <Trans>
          Traffic data will appear after a successful results refresh.
        </Trans>
      </Callout>
    );
  } else if (traffic.error && traffic.error !== "NO_ROWS_IN_UNIT_QUERY") {
    const trafficError = traffic.error;
    body = (
      <Callout status="error">
        <Trans>
          There was an error running the traffic query for the Health tab:{" "}
          {trafficError}.
        </Trans>
      </Callout>
    );
  } else if (totalUsers === 0) {
    body = (
      <Callout status="info">
        <Trans>
          No data found. It is likely there are no units in your Bandit yet.
        </Trans>
      </Callout>
    );
  } else {
    const resultsDate = datetimeAt(results.dateCreated);
    const newerRunError = newerRun?.error;
    body = (
      <>
        {newerRun?.status === "error" ? (
          <Callout status="warning" mb="3">
            <Trans>
              The most recent refresh failed, so the health results below are
              from the last successful refresh on {resultsDate}.
            </Trans>
            {newerRunError ? (
              <>
                {" "}
                <Trans>Error: {newerRunError}</Trans>
              </>
            ) : null}
          </Callout>
        ) : newerRun?.status === "running" ? (
          <Callout status="info" mb="3">
            <Trans>
              A refresh is in progress. The health results below are from the
              last successful refresh on {resultsDate}.
            </Trans>
          </Callout>
        ) : null}

        <IssueTags issues={healthIssues} />

        <TrafficCard
          traffic={traffic}
          variations={variations}
          isBandit
          disableDimensions
          overTimeTitle={t`Traffic Over Time`}
        />

        {health?.multipleExposures === null ? (
          <Callout status="info" mt="4">
            <Trans>
              Balance and multiple exposure checks need the bandit_version,
              leaf_id, and variation_weights columns in your assignment query.
            </Trans>
          </Callout>
        ) : (
          <>
            <div
              id="balanceCheck"
              style={{
                scrollMarginTop: SCROLL_MARGIN_UNDER_TABS,
              }}
            >
              <ContextualBanditSRMCard
                srm={health?.srm?.pValue ?? null}
                variations={variations}
                users={overallUsers}
                totalUsers={totalUsers}
                latestPeriod={health?.srm?.latestPeriod ?? null}
              />
            </div>

            <div
              id="multipleExposures"
              style={{
                scrollMarginTop: SCROLL_MARGIN_UNDER_TABS,
              }}
            >
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
