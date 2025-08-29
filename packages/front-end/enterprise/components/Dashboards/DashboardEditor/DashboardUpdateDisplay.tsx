import React, { useContext, useMemo } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { ago, getValidDate } from "shared/dates";
import { PiArrowClockwise, PiInfo, PiLightning } from "react-icons/pi";
import clsx from "clsx";
import { dashboardCanAutoUpdate } from "shared/enterprise";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Radix/Button";
import { useUser } from "@/services/UserContext";
import { DashboardSnapshotContext } from "../DashboardSnapshotProvider";
import DashboardViewQueriesButton from "./DashboardViewQueriesButton";

function SnapshotStatusSummary({
  blocks,
  enableAutoUpdates,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  enableAutoUpdates: boolean;
}) {
  const {
    settings: { updateSchedule },
  } = useUser();
  const {
    experiment,
    defaultSnapshot: snapshot,
    refreshError,
    allQueries,
  } = useContext(DashboardSnapshotContext);
  const numFailed = useMemo(
    () => allQueries.filter((q) => q.status === "failed").length,
    [allQueries],
  );

  if (!snapshot) return null;

  const autoUpdateEnabled =
    enableAutoUpdates &&
    dashboardCanAutoUpdate({ blocks }) &&
    updateSchedule?.type !== "never" &&
    experiment?.autoSnapshots;
  const nextUpdate = experiment?.nextSnapshotAttempt;

  const textColor = refreshError || numFailed > 0 ? "red" : undefined;
  const content = refreshError
    ? "Update Failed"
    : numFailed > 0
      ? "One or more queries failed"
      : snapshot.runStarted
        ? `Updated ${ago(snapshot.runStarted).replace("about ", "")}`
        : "Not started yet";
  const tooltipBody = refreshError ? refreshError : undefined;

  return (
    <Flex gap="1" align="center">
      <Text size="1">
        {autoUpdateEnabled &&
          nextUpdate &&
          getValidDate(nextUpdate) > new Date() && (
            <Tooltip
              tipPosition="top"
              body={`Next auto-update ${ago(nextUpdate)}`}
            >
              <PiLightning style={{ color: "var(--violet-11)" }} />{" "}
            </Tooltip>
          )}
      </Text>
      <Text size="1" color={textColor}>
        {content}
      </Text>
      {tooltipBody && (
        <Tooltip
          body={tooltipBody}
          delay={0}
          tipPosition="top"
          popperStyle={{ paddingRight: "16px" }}
        >
          <Flex align="center">
            <Text color="red">
              <PiInfo />
            </Text>
          </Flex>
        </Tooltip>
      )}
    </Flex>
  );
}

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  enableAutoUpdates: boolean;
  disabled: boolean;
  isEditing: boolean;
}

export default function DashboardUpdateDisplay({
  blocks,
  enableAutoUpdates,
  disabled,
  isEditing,
}: Props) {
  const {
    defaultSnapshot: snapshot,
    loading,
    refreshStatus,
    allQueries,
    updateAllSnapshots,
  } = useContext(DashboardSnapshotContext);
  const refreshing = ["running", "queued"].includes(refreshStatus);
  const { numQueries, numFinished } = useMemo(() => {
    const numQueries = allQueries.length;
    const numFinished = allQueries.filter((q) =>
      ["succeeded", "failed"].includes(q.status),
    ).length;
    return { numQueries, numFinished };
  }, [allQueries]);
  if (loading)
    return (
      <Flex gap="1" align="center">
        <LoadingSpinner />
        <Text>Loading dashboard...</Text>
      </Flex>
    );
  if (!snapshot) return null;

  return (
    <Flex
      gap="1"
      align="center"
      className={clsx({ "dashboard-disabled": disabled })}
      style={{ minWidth: 250 }}
      justify={"end"}
    >
      <SnapshotStatusSummary
        blocks={blocks}
        enableAutoUpdates={enableAutoUpdates}
      />
      {isEditing && (
        <DashboardViewQueriesButton
          size="1"
          buttonProps={{ variant: "ghost" }}
          hideQueryCount
        />
      )}

      <div className="position-relative">
        <Button
          size="xs"
          disabled={refreshing}
          icon={refreshing ? <LoadingSpinner /> : <PiArrowClockwise />}
          iconPosition="left"
          variant="ghost"
          onClick={updateAllSnapshots}
        >
          {refreshing ? "Refreshing" : "Update"}
        </Button>
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
    </Flex>
  );
}
