import { useMemo, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { RampScheduleInterface, SafeRolloutInterface } from "shared/validators";
import { formatShortAgo, getValidDate } from "shared/dates";
import { getSafeRolloutSnapshotAnalysis } from "shared/util";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import {
  PiCaretDownBold,
  PiDatabase,
  PiLightning,
  PiLightningSlash,
} from "react-icons/pi";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import Metadata from "@/ui/Metadata";
import MonitoredIcon from "@/components/Features/RuleModal/MonitoredIcon";
import {
  getRampHealthOverview,
  useRampMonitoringSignals,
} from "@/components/RampSchedule/RampMonitoringSignals";
import { numberFmt } from "./MetricSection";

// ---------------------------------------------------------------------------
// SafeRolloutStatusBar
// ---------------------------------------------------------------------------

export function SafeRolloutStatusBar({
  rampSchedule,
  snapshot,
  safeRollout,
  detailsId,
  controlsExpanded,
  onToggleExpanded,
  useDummyData,
}: {
  rampSchedule: RampScheduleInterface;
  snapshot?: SafeRolloutSnapshotInterface;
  safeRollout?: SafeRolloutInterface;
  detailsId: string;
  controlsExpanded: boolean;
  onToggleExpanded: () => void;
  useDummyData?: boolean;
}) {
  const signalResult = useRampMonitoringSignals(rampSchedule, {
    snapshot,
    safeRollout,
  });
  const overview = useMemo(
    () => getRampHealthOverview(rampSchedule, signalResult),
    [rampSchedule, signalResult],
  );
  const firstMonitoredStepIndex = useMemo(
    () => rampSchedule.steps.findIndex((s) => !!s.monitored),
    [rampSchedule.steps],
  );
  const monitoringHasStarted =
    !!rampSchedule.monitoringStartDate ||
    (firstMonitoredStepIndex >= 0 &&
      rampSchedule.currentStepIndex >= firstMonitoredStepIndex);

  const lastSnapshotAt = snapshot?.dateCreated
    ? getValidDate(snapshot.dateCreated)
    : undefined;

  const totalUsers = useMemo(() => {
    if (!snapshot) return undefined;
    const analysis = getSafeRolloutSnapshotAnalysis(snapshot);
    const vars = analysis?.results?.[0]?.variations;
    if (vars && vars.length > 0) {
      return vars.reduce((sum, v) => sum + v.users, 0);
    }
    const trafficUnits = snapshot.health?.traffic?.overall?.variationUnits;
    if (trafficUnits && trafficUnits.length > 0) {
      return trafficUnits.reduce((sum, n) => sum + n, 0);
    }
    return undefined;
  }, [snapshot]);
  const iconColorBySeverity: Record<
    ReturnType<typeof getRampHealthOverview>["severity"],
    string
  > = {
    critical: "var(--red-9)",
    warning: "var(--amber-10)",
    info: "var(--blue-9)",
    healthy: "var(--violet-9)",
    inactive: "var(--gray-9)",
  };
  const statusIconColor = iconColorBySeverity[overview.severity];

  return (
    <Box>
      <button
        type="button"
        aria-expanded={controlsExpanded}
        aria-controls={detailsId}
        onClick={onToggleExpanded}
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          padding: 0,
          width: "100%",
          textAlign: "left",
        }}
      >
        <Flex align="center" justify="between" gap="3" pb="1">
          <Flex align="start" gap="2" style={{ minWidth: 0 }}>
            <Box
              style={{
                width: 18,
                flexShrink: 0,
                display: "flex",
                justifyContent: "center",
                paddingTop: 1,
              }}
            >
              <MonitoredIcon size={18} style={{ color: statusIconColor }} />
            </Box>
            <Flex direction="column" style={{ minWidth: 0 }}>
              <Text size="large" weight="semibold" color="text-high" truncate>
                {overview.label}
              </Text>
              <Text size="medium" color="text-mid">
                {overview.summary}
              </Text>
            </Flex>
          </Flex>

          <Flex align="center" gap="2" flexShrink="0">
            {useDummyData && (
              <Badge
                label="Using dummy data"
                color="cyan"
                variant="soft"
                size="sm"
              />
            )}
            {monitoringHasStarted && lastSnapshotAt && (
              <Text size="medium" color="text-mid" whiteSpace="nowrap">
                {formatShortAgo(lastSnapshotAt)}
              </Text>
            )}
            {monitoringHasStarted && totalUsers !== undefined && (
              <>
                <Text size="medium" color="text-low">
                  ·
                </Text>
                <Text size="medium" color="text-mid" whiteSpace="nowrap">
                  {numberFmt.format(totalUsers)} users
                </Text>
              </>
            )}
            <PiCaretDownBold
              style={{
                transform: controlsExpanded ? undefined : "rotate(-90deg)",
                transition: "transform 0.15s",
                color: "var(--color-text-mid)",
              }}
              size={15}
            />
          </Flex>
        </Flex>
      </button>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// MonitoringControls
// ---------------------------------------------------------------------------

export function MonitoringControls({
  rampSchedule,
  safeRolloutId,
  snapshot,
  latest,
  mutateSnapshot,
}: {
  rampSchedule: RampScheduleInterface;
  safeRolloutId: string;
  snapshot?: SafeRolloutSnapshotInterface;
  latest?: SafeRolloutSnapshotInterface;
  mutateSnapshot: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const snapshotCtx = useSafeRolloutSnapshot();

  const { getDatasourceById } = useDefinitions();
  const safeRollout = snapshotCtx.safeRollout;

  const { data: srData, mutate: mutateSr } = useApi<{
    safeRollout: {
      id: string;
      autoSnapshots?: boolean;
      datasourceId?: string;
      nextSnapshotAttempt?: string | Date;
    };
  }>(`/safe-rollout/${safeRolloutId}`, {
    shouldRun: () => !safeRollout && !!safeRolloutId,
  });
  const srFromApi = useMemo(() => {
    if (safeRollout) return safeRollout;
    return srData?.safeRollout as typeof safeRollout | undefined;
  }, [safeRollout, srData]);

  const monitoringMode =
    rampSchedule.monitoringConfig?.monitoringMode ??
    (rampSchedule.monitoringConfig?.autoUpdate === false ? "manual" : "auto");
  const autoSnapshots = srFromApi?.autoSnapshots ?? monitoringMode === "auto";
  const datasourceId =
    srFromApi?.datasourceId ??
    snapshot?.settings?.datasourceId ??
    rampSchedule.monitoringConfig?.datasourceId;

  const currentStepIsMonitored =
    rampSchedule.currentStepIndex >= 0 &&
    !!rampSchedule.steps[rampSchedule.currentStepIndex]?.monitored;
  const effectiveAutoUpdate =
    monitoringMode === "auto" &&
    rampSchedule.status === "running" &&
    currentStepIsMonitored &&
    autoSnapshots;
  const blockedReason =
    monitoringMode === "manual"
      ? "Manual mode enabled"
      : rampSchedule.status !== "running"
        ? `Ramp is ${rampSchedule.status}`
        : currentStepIsMonitored
          ? null
          : "Current step is not monitored";

  const [queriesOpen, setQueriesOpen] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const latestSnap = latest ?? snapshot;

  const ds = datasourceId ? getDatasourceById(datasourceId) : null;
  const canRunQueries = ds
    ? permissionsUtil.canRunExperimentQueries(ds)
    : !!datasourceId;

  const totalUsers = useMemo(() => {
    if (!snapshot) return undefined;
    const analysis = getSafeRolloutSnapshotAnalysis(snapshot);
    const vars = analysis?.results?.[0]?.variations;
    if (vars && vars.length > 0) {
      return vars.reduce((sum, v) => sum + v.users, 0);
    }
    const trafficUnits = snapshot.health?.traffic?.overall?.variationUnits;
    if (trafficUnits && trafficUnits.length > 0) {
      return trafficUnits.reduce((sum, n) => sum + n, 0);
    }
    return undefined;
  }, [snapshot]);

  const handleToggleMonitoringMode = async () => {
    const nextMode = monitoringMode === "auto" ? "manual" : "auto";
    await apiCall(
      `/ramp-schedule/${rampSchedule.id}/actions/set-monitoring-mode`,
      {
        method: "POST",
        body: JSON.stringify({ monitoringMode: nextMode }),
      },
    );
    await Promise.all([mutateSnapshot(), mutateSr()]);
  };

  const nextUpdate = srFromApi?.nextSnapshotAttempt
    ? getValidDate(srFromApi.nextSnapshotAttempt)
    : undefined;

  const autoUpdateTooltipBody = (() => {
    let statusLine: string;
    let actionLine: string;
    if (monitoringMode === "manual") {
      statusLine =
        "Auto-updates are disabled. Currently, monitored steps can only be progressed by manual updates.";
      actionLine = "Click to re-enable automatic updates.";
    } else {
      if (!effectiveAutoUpdate) {
        statusLine = blockedReason
          ? `Auto-updates enabled, currently blocked: ${blockedReason}.`
          : "Auto-updates are enabled, but currently blocked.";
      } else if (nextUpdate && nextUpdate > new Date()) {
        const mins = Math.max(
          1,
          Math.round((nextUpdate.getTime() - Date.now()) / 60_000),
        );
        statusLine = `Auto-updates are enabled. Next update in ~${mins}m.`;
      } else {
        statusLine = "Auto-updates are enabled.";
      }
      actionLine = "Click to disable auto-updates.";
    }
    return (
      <div style={{ maxWidth: 340 }}>
        <div style={{ marginBottom: 8 }}>{statusLine}</div>
        <div>{actionLine}</div>
      </div>
    );
  })();

  const isTerminal = ["completed", "rolled-back"].includes(rampSchedule.status);
  const firstMonitoredStepIndex = rampSchedule.steps.findIndex(
    (s) => s.monitored,
  );
  const lastMonitoredStepIndex = rampSchedule.steps.reduce(
    (last, s, i) => (s.monitored ? i : last),
    -1,
  );
  const isWithinMonitoredRange =
    firstMonitoredStepIndex >= 0 &&
    rampSchedule.currentStepIndex >= firstMonitoredStepIndex &&
    rampSchedule.currentStepIndex <= lastMonitoredStepIndex;
  const showMonitoringControls = !isTerminal && isWithinMonitoredRange;

  const lastUpdated = snapshot?.dateCreated
    ? getValidDate(snapshot.dateCreated)
    : undefined;

  return (
    <>
      <Separator size="4" mb="3" />
      <Flex
        align="center"
        justify="between"
        mb="2"
        style={{ fontSize: 13, minHeight: 32 }}
      >
        <Flex align="center" gap="3">
          {totalUsers !== undefined && (
            <Metadata
              label="Monitored Users"
              value={numberFmt.format(totalUsers)}
              style={{ whiteSpace: "nowrap" }}
            />
          )}
        </Flex>

        <Flex align="center" gap="3">
          {showMonitoringControls && (
            <Flex align="center" gap="1">
              <Tooltip body={autoUpdateTooltipBody}>
                {monitoringMode === "auto" ? (
                  <IconButton
                    variant="ghost"
                    radius="full"
                    aria-label="Disable auto-monitoring"
                    disabled={!canRunQueries}
                    onClick={
                      canRunQueries ? handleToggleMonitoringMode : undefined
                    }
                    style={{
                      color: effectiveAutoUpdate
                        ? "var(--violet-11)"
                        : "var(--gray-8)",
                    }}
                    size="1"
                  >
                    <PiLightning size={18} />
                  </IconButton>
                ) : (
                  <IconButton
                    variant="ghost"
                    radius="full"
                    aria-label="Enable auto-monitoring"
                    disabled={!canRunQueries}
                    onClick={
                      canRunQueries ? handleToggleMonitoringMode : undefined
                    }
                    style={{ color: "var(--gray-8)" }}
                  >
                    <PiLightningSlash size={18} />
                  </IconButton>
                )}
              </Tooltip>
              {lastUpdated && (
                <Tooltip
                  body={`Last update: ${getValidDate(lastUpdated).toLocaleString()}`}
                >
                  <Text size="medium" color="text-mid" whiteSpace="nowrap">
                    Updated: {formatShortAgo(lastUpdated)}
                  </Text>
                </Tooltip>
              )}
              {!lastUpdated && (
                <span style={{ color: "var(--color-text-mid)" }}>
                  Not updated yet
                </span>
              )}
            </Flex>
          )}
          {!showMonitoringControls && lastUpdated && (
            <Tooltip
              body={`Last update: ${getValidDate(lastUpdated).toLocaleString()}`}
            >
              <Text size="medium" color="text-mid" whiteSpace="nowrap">
                Updated: {formatShortAgo(lastUpdated)}
              </Text>
            </Tooltip>
          )}
          {showMonitoringControls && (
            <Flex align="center" gap="3">
              {latestSnap &&
                latestSnap.queries.length > 0 &&
                (() => {
                  const hasError =
                    !!latestSnap.error ||
                    latestSnap.queries.some((q) => q.status === "failed");
                  const isRunning = latestSnap.queries.some(
                    (q) => q.status === "running",
                  );
                  return (
                    <Tooltip
                      body={
                        hasError
                          ? "Query error — click to inspect"
                          : isRunning
                            ? "Queries running — click to inspect"
                            : "View queries"
                      }
                      tipMinWidth="50"
                    >
                      <div
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                        }}
                      >
                        <IconButton
                          variant="ghost"
                          color="violet"
                          size="1"
                          onClick={() => setQueriesOpen(true)}
                          aria-label="View queries"
                          style={{ marginTop: "auto", marginBottom: "auto" }}
                        >
                          <PiDatabase size={16} />
                        </IconButton>
                        {hasError && (
                          <span
                            style={{
                              position: "absolute",
                              top: 1,
                              right: 1,
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "var(--red-9)",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                      </div>
                    </Tooltip>
                  );
                })()}
              {canRunQueries && (
                <RunQueriesButton
                  cta="Update"
                  cancelEndpoint={
                    latestSnap
                      ? `/safe-rollout/snapshot/${latestSnap.id}/cancel`
                      : ""
                  }
                  mutate={mutateSnapshot}
                  model={{
                    queries: latestSnap?.queries || [],
                    runStarted: latestSnap?.runStarted ?? null,
                  }}
                  icon="refresh"
                  useRadixButton
                  radixVariant="outline"
                  size="xs"
                  onSubmit={async () => {
                    try {
                      await apiCall(`/safe-rollout/${safeRolloutId}/snapshot`, {
                        method: "POST",
                      });
                      setRefreshError("");
                    } catch (e) {
                      setRefreshError(
                        e instanceof Error ? e.message : String(e),
                      );
                    }
                    mutateSnapshot();
                  }}
                />
              )}
            </Flex>
          )}
        </Flex>
      </Flex>

      {refreshError && (
        <Callout status="error" mb="2">
          <strong>Error updating data: </strong> {refreshError}
        </Callout>
      )}

      {queriesOpen && latestSnap && (
        <AsyncQueriesModal
          queries={latestSnap.queries.map((q) => q.query)}
          savedQueries={[]}
          error={latestSnap.error ?? undefined}
          close={() => setQueriesOpen(false)}
        />
      )}
    </>
  );
}
