import React, { useContext } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { ago } from "shared/dates";
import { PiArrowClockwise, PiLightning } from "react-icons/pi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Radix/Button";
import { DashboardSnapshotContext } from "../DashboardSnapshotProvider";

export default function DashboardUpdateDisplay() {
  const {
    defaultSnapshot: snapshot,
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
  if (!snapshot) return null;
  // TODO
  const canAutoUpdate = true;
  const timeTillUpdate = "24 minutes";

  return (
    <Flex gap="1" align="center">
      <Text>
        {canAutoUpdate && (
          <Tooltip
            tipPosition="top"
            body={`Next auto-update: ${timeTillUpdate}`}
          >
            <PiLightning />{" "}
          </Tooltip>
        )}
        {snapshot.runStarted
          ? `Updated ${ago(snapshot.runStarted).replace("about ", "")}`
          : "Not started yet"}
      </Text>
      <Button
        disabled={refreshing || snapshot.status === "running"}
        icon={<PiArrowClockwise />}
        iconPosition="left"
        variant="ghost"
        loading={refreshing}
        onClick={updateAllSnapshots}
      >
        Update
      </Button>
    </Flex>
  );
}
