import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiContextualBanditInterface } from "shared/validators";
import { ExperimentReportVariation } from "shared/types/report";
import { datetime } from "shared/dates";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { IssueTags } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import {
  useContextualBanditHealthIssues,
  useContextualBanditResults,
} from "@/hooks/useContextualBandits";
import ContextualBanditSRMCard from "./ContextualBanditSRMCard";

export default function ContextualBanditHealthTab({
  cb,
}: {
  cb: ApiContextualBanditInterface;
}) {
  const { latest, loading, error } = useContextualBanditResults(cb.id);
  const healthIssues = useContextualBanditHealthIssues(cb);

  const frozenVariations = useMemo(() => latest?.variations ?? [], [latest]);

  const variations: ExperimentReportVariation[] = useMemo(
    () =>
      frozenVariations.map((v, i) => ({
        id: v.variationId,
        index: i,
        name: v.variationName ?? v.variationId,
        weight: v.weight,
      })),
    [frozenVariations],
  );

  const traffic = latest?.traffic ?? null;
  const srmResult = latest?.srm ?? null;
  const srm = srmResult?.pValue ?? null;
  const multipleExposures = latest?.multipleExposures ?? 0;
  const overallUsers = useMemo(
    () =>
      frozenVariations.map(
        (_, i) => traffic?.overall?.variationUnits?.[i] ?? 0,
      ),
    [frozenVariations, traffic],
  );

  const totalUsers = overallUsers.reduce((sum, n) => sum + n, 0);

  const healthFromEarlierRun =
    (latest?.healthSnapshotId ?? null) !== null &&
    latest?.healthSnapshotId !== latest?.id;
  const latestFailed = latest?.status === "error";
  const latestRunning = latest?.status === "running";
  const healthDateLabel = latest?.healthDateCreated
    ? datetime(latest.healthDateCreated)
    : null;

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

  if (!latest) {
    return (
      <Callout status="info" mt="3">
        No updates yet. Traffic and health results will appear after a
        successful refresh of the results.
      </Callout>
    );
  }

  if (!traffic) {
    return (
      <Callout status="info" mt="3">
        Traffic data will appear after a successful results refresh.
      </Callout>
    );
  }

  if (totalUsers === 0) {
    return (
      <Callout status="info" mt="3">
        No data found. It is likely there are no units in your Bandit yet.
      </Callout>
    );
  }

  return (
    <Flex direction="column">
      {healthFromEarlierRun ? (
        <Callout status={latestFailed ? "warning" : "info"} mb="3">
          {latestFailed
            ? "The most recent refresh failed, so the health results below are from an earlier successful refresh"
            : latestRunning
              ? "A refresh is in progress. The health results below are from the last successful refresh"
              : "The health results below are from an earlier successful refresh"}
          {healthDateLabel ? ` from ${healthDateLabel}.` : "."}
          {latestFailed && latest?.error ? ` Error: ${latest.error}` : ""}
        </Callout>
      ) : latestFailed ? (
        <Callout status="warning" mb="3">
          The most recent refresh failed, so these health results may be out of
          date.
          {latest?.error ? ` Error: ${latest.error}` : ""}
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

      <div id="balanceCheck" style={{ scrollMarginTop: "100px" }}>
        <ContextualBanditSRMCard
          srm={srm}
          variations={variations}
          users={overallUsers}
          totalUsers={totalUsers}
          latestPeriod={latest?.srm?.latestPeriod ?? null}
        />
      </div>

      <div id="multipleExposures" style={{ scrollMarginTop: "100px" }}>
        {srmResult === null ? (
          <Callout status="info">
            Multiple exposures data will appear after a successful results
            refresh.
          </Callout>
        ) : (
          <MultipleExposuresCard
            totalUsers={totalUsers}
            multipleExposures={multipleExposures}
            isBandit
          />
        )}
      </div>
    </Flex>
  );
}
