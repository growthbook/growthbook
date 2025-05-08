import React, { useContext } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { PiArrowClockwise, PiLightning } from "react-icons/pi";
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

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  enableAutoUpdates: boolean;
  disabled: boolean;
}

export default function DashboardUpdateDisplay({
  blocks,
  enableAutoUpdates,
  disabled,
}: Props) {
  const {
    settings: { updateSchedule },
  } = useUser();
  const {
    experiment,
    defaultSnapshot: snapshot,
    loading,
    refreshing,
    numQueries,
    numFinished,
    updateAllSnapshots,
  } = useContext(DashboardSnapshotContext);
  if (loading)
    return (
      <Flex gap="1" align="center">
        <LoadingSpinner />
        <Text>Loading dashboard...</Text>
      </Flex>
    );
  if (!snapshot) return null;
  const autoUpdateEnabled =
    enableAutoUpdates &&
    dashboardCanAutoUpdate({ blocks }) &&
    updateSchedule?.type !== "never" &&
    experiment?.autoSnapshots;
  const timeTillUpdate = experiment?.nextSnapshotAttempt;

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
            body={`Next auto-update ${ago(timeTillUpdate)}`}
          >
            <PiLightning />{" "}
          </Tooltip>
        )}
        {snapshot.runStarted
          ? `Updated ${ago(snapshot.runStarted).replace("about ", "")}`
          : "Not started yet"}
      </Text>
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
        {refreshing && numQueries > 0 && (
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
