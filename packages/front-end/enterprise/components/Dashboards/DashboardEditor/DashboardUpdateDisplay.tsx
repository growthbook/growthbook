import React, { useContext } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { PiArrowClockwise, PiLightning } from "react-icons/pi";
import clsx from "clsx";
import { dashboardCanAutoUpdate } from "shared/enterprise";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Radix/Button";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { DashboardSnapshotContext } from "../DashboardSnapshotProvider";

interface Props {
  blocks: DashboardBlockData<DashboardBlockInterface>[];
  enableAutoUpdates: boolean;
  disabled: boolean;
}

export default function DashboardUpdateDisplay({
  blocks,
  enableAutoUpdates,
  disabled,
}: Props) {
  const {
    experiment,
    defaultSnapshot: finishedSnapshot,
    latestSnapshot: loadingSnapshot,
    loading,
    refreshing,
    updateAllSnapshots,
  } = useContext(DashboardSnapshotContext);
  if (loading)
    return (
      <Flex gap="1" align="center">
        <LoadingSpinner />
        <Text>Loading dashboard...</Text>
      </Flex>
    );
  if (!loadingSnapshot || !finishedSnapshot) return null;
  const autoUpdateEnabled =
    enableAutoUpdates &&
    dashboardCanAutoUpdate({ blocks }) &&
    experiment?.autoSnapshots;
  const timeTillUpdate = experiment?.nextSnapshotAttempt;

  const { status } = getQueryStatus(loadingSnapshot.queries || []);

  const numFinished = loadingSnapshot.queries.filter(
    (q) => q.status === "succeeded"
  ).length;
  const numQueries = loadingSnapshot.queries.length;

  return (
    <Flex
      gap="1"
      align="center"
      className={clsx({ "dashboard-disabled": disabled })}
    >
      <Text size="1">
        {autoUpdateEnabled && timeTillUpdate && (
          <Tooltip
            tipPosition="top"
            body={`Next auto-update: ${ago(timeTillUpdate)}`}
          >
            <PiLightning />{" "}
          </Tooltip>
        )}
        {finishedSnapshot.runStarted
          ? `Updated ${ago(finishedSnapshot.runStarted).replace("about ", "")}`
          : "Not started yet"}
      </Text>
      <div className="position-relative">
        <Button
          size="xs"
          disabled={refreshing || loadingSnapshot.status === "running"}
          icon={
            status === "running" ? <LoadingSpinner /> : <PiArrowClockwise />
          }
          iconPosition="left"
          variant="ghost"
          onClick={updateAllSnapshots}
        >
          {status === "running" ? "Refreshing" : "Update"}
        </Button>
        {status === "running" && numQueries > 0 && (
          <div
            className="position-absolute bg-info"
            style={{
              width: Math.floor((100 * numFinished) / numQueries) + "%",
              height: 4,
            }}
          />
        )}
      </div>
    </Flex>
  );
}
