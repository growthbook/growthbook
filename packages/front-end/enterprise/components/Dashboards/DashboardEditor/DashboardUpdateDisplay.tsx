import { useContext, useMemo, useState } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { ago, getValidDate } from "shared/dates";
import { PiArrowClockwise, PiInfo, PiLightning } from "react-icons/pi";
import clsx from "clsx";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardViewQueriesButton from "./DashboardViewQueriesButton";

function DashboardStatusSummary({
  enableAutoUpdates,
  nextUpdate,
  dashboardLastUpdated,
  needsUpdate,
}: {
  enableAutoUpdates: boolean;
  nextUpdate: Date | undefined;
  dashboardLastUpdated?: Date; // Optional rather than Date | undefined as this doesn't apply to experiment dashboards
  needsUpdate: boolean;
}) {
  const {
    settings: { updateSchedule },
  } = useUser();
  const {
    defaultSnapshot,
    snapshotsMap,
    metricAnalysesMap,
    refreshError,
    allQueries,
    snapshotError,
  } = useContext(DashboardSnapshotContext);
  const numFailed = useMemo(
    () => allQueries.filter((q) => q.status === "failed").length,
    [allQueries],
  );

  // Find any snapshot or metric analysis actively in use by the dashboard (if one exists)
  const snapshotEntry = snapshotsMap
    .entries()
    .find(([snapshotId]) => snapshotId !== defaultSnapshot?.id);
  const metricAnalysisEntry = [...metricAnalysesMap.entries()][0];

  const snapshot = snapshotEntry ? snapshotEntry[1] : defaultSnapshot;
  const metricAnalysis = metricAnalysisEntry?.[1];

  const textColor =
    refreshError || numFailed > 0 || snapshotError
      ? "var(--red-11)"
      : needsUpdate
        ? "var(--amber-11)"
        : "var(--color-text-mid)";
  const lastUpdateTime =
    metricAnalysis?.runStarted ??
    dashboardLastUpdated ??
    snapshot?.runStarted ??
    undefined;
  const content = refreshError
    ? "Update Failed"
    : numFailed > 0
      ? "One or more queries failed"
      : snapshotError
        ? "Error running analysis"
        : needsUpdate
          ? "Filters changed"
          : lastUpdateTime
            ? `Updated ${ago(lastUpdateTime).replace("about ", "")}`
            : "Not started yet";
  const tooltipBody = refreshError ? refreshError : undefined;

  return (
    <Flex gap="1" align="center">
      <Text size="small">
        {enableAutoUpdates && updateSchedule?.type !== "never" && (
          <Tooltip
            tipPosition="top"
            body={
              nextUpdate && getValidDate(nextUpdate) > new Date()
                ? `Next auto-update ${ago(nextUpdate)}`
                : "Auto-update starting soon"
            }
          >
            <PiLightning style={{ color: "var(--violet-11)" }} />{" "}
          </Tooltip>
        )}
      </Text>
      <Text size="small">
        <span style={{ color: textColor }}>{content}</span>
      </Text>
      {tooltipBody && (
        <Tooltip
          body={tooltipBody}
          delay={0}
          tipPosition="top"
          popperStyle={{ paddingRight: "16px" }}
        >
          <Flex align="center">
            <span style={{ color: "var(--red-11)" }}>
              <PiInfo />
            </span>
          </Flex>
        </Tooltip>
      )}
    </Flex>
  );
}

interface Props {
  dashboardId: string;
  enableAutoUpdates: boolean;
  nextUpdate: Date | undefined;
  dashboardLastUpdated?: Date;
  disabled: boolean;
  isEditing: boolean;
  needsUpdate?: boolean;
  updateTemporaryDashboardResults?: () => Promise<void>;
  onUpdated?: () => void;
}

export default function DashboardUpdateDisplay({
  dashboardId,
  enableAutoUpdates,
  nextUpdate,
  dashboardLastUpdated,
  disabled,
  isEditing,
  needsUpdate = false,
  updateTemporaryDashboardResults,
  onUpdated,
}: Props) {
  const [updatingTemporaryDashboard, setUpdatingTemporaryDashboard] =
    useState(false);
  const { datasources } = useDefinitions();
  const {
    projects,
    loading,
    refreshStatus,
    allQueries,
    savedQueriesMap,
    updateAllSnapshots,
  } = useContext(DashboardSnapshotContext);
  const refreshing =
    updatingTemporaryDashboard || ["running", "queued"].includes(refreshStatus);
  const { numQueries, numFinished } = useMemo(() => {
    const numQueries = allQueries.length;
    const numFinished = allQueries.filter((q) =>
      ["succeeded", "failed"].includes(q.status),
    ).length;
    return { numQueries, numFinished };
  }, [allQueries]);
  const datasourceIds = useMemo(
    () => [...(savedQueriesMap?.values().map((sq) => sq.datasourceId) ?? [])],
    [savedQueriesMap],
  );
  const datasourcesInUse = datasourceIds.map((id) =>
    datasources.find((ds) => ds.id === id),
  );
  const { canRunSqlExplorerQueries, canCreateAnalyses } = usePermissionsUtil();

  const canRefresh =
    canCreateAnalyses(projects) &&
    !datasourcesInUse.some((ds) => ds && !canRunSqlExplorerQueries(ds));
  if (loading)
    return (
      <Flex gap="1" align="center">
        <LoadingSpinner />
        <Text>Loading dashboard...</Text>
      </Flex>
    );

  return (
    <Flex
      gap="3"
      align="center"
      className={clsx({ "dashboard-disabled": disabled })}
      justify={"end"}
    >
      <DashboardStatusSummary
        enableAutoUpdates={enableAutoUpdates}
        nextUpdate={nextUpdate}
        dashboardLastUpdated={dashboardLastUpdated}
        needsUpdate={needsUpdate}
      />
      <div className="position-relative">
        {canRefresh && (
          <Button
            size="xs"
            disabled={
              refreshing ||
              !dashboardId ||
              (dashboardId === "new" && !updateTemporaryDashboardResults) ||
              (!needsUpdate && !allQueries.length && savedQueriesMap.size === 0)
            }
            icon={refreshing ? <LoadingSpinner /> : <PiArrowClockwise />}
            iconPosition="left"
            variant={!isEditing ? "ghost" : needsUpdate ? "solid" : "outline"}
            onClick={async () => {
              if (updateTemporaryDashboardResults) {
                setUpdatingTemporaryDashboard(true);
                try {
                  await updateTemporaryDashboardResults();
                  onUpdated?.();
                } finally {
                  setUpdatingTemporaryDashboard(false);
                }
              } else {
                await updateAllSnapshots();
                onUpdated?.();
              }
            }}
          >
            {refreshing ? "Refreshing" : "Update"}
          </Button>
        )}

        {refreshing && allQueries.length > 0 && (
          <div
            className="position-absolute bg-info"
            style={{
              width: Math.floor((100 * numFinished) / numQueries) + "%",
              height: 2,
              bottom: 0,
            }}
          />
        )}
      </div>
      {isEditing && <Separator orientation="vertical" />}
      {isEditing && (
        <DashboardViewQueriesButton
          size="small"
          buttonProps={{ variant: "ghost" }}
          hideQueryCount
          iconOnly
        />
      )}
    </Flex>
  );
}
