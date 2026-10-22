import { useCallback, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPause, PiPlay } from "react-icons/pi";
import { EventForwarderStatus } from "shared/types/event-forwarder";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useEventForwarderProvisioningPoll } from "@/components/Settings/EditDataSource/EventForwarder/useEventForwarderProvisioningPoll";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

const statusLabels: Record<EventForwarderStatus, string> = {
  unconfigured: "Not configured",
  pending: "Pending",
  ready: "Ready",
  paused: "Paused",
  error: "Error",
  schema_update_error: "Schema Update Error",
};

const statusColors: Record<
  EventForwarderStatus,
  "gray" | "green" | "amber" | "red"
> = {
  unconfigured: "gray",
  pending: "gray",
  ready: "green",
  paused: "amber",
  error: "red",
  schema_update_error: "red",
};

export default function EventForwarderTab({
  dataSource,
  canEdit,
  onRefresh,
}: {
  dataSource: DataSourceInterfaceWithParams;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pauseResumeLoading, setPauseResumeLoading] = useState(false);
  const config = dataSource.eventForwarderConfig;
  const handleRefresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);
  const { isProvisioning, pollTimedOut } = useEventForwarderProvisioningPoll({
    datasourceId: dataSource.id,
    status: config?.status,
    onRefresh: handleRefresh,
  });

  if (!config || config.status === "unconfigured") {
    return null;
  }

  const isReady = config.status === "ready";
  const isPaused = config.status === "paused";
  const canToggle = canEdit && (isReady || isPaused);
  const errorMessage =
    actionError ||
    (config.status === "error" || config.status === "schema_update_error"
      ? config.lastProvisioningError?.trim()
      : "") ||
    (pollTimedOut ? "Provisioning timed out." : "");

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        <Flex align="center" gap="2">
          <Heading as="h2" size="md" mb="0">
            Event Forwarder
          </Heading>
          {isProvisioning ? (
            <Flex align="center" gap="2">
              <LoadingSpinner />
              <Text size="sm" color="text-mid">
                Setting up
              </Text>
            </Flex>
          ) : (
            <Badge
              label={statusLabels[config.status]}
              color={statusColors[config.status]}
              variant="soft"
            />
          )}
        </Flex>
        {canToggle ? (
          <Button
            variant="outline"
            color={isReady ? "red" : undefined}
            icon={isReady ? <PiPause /> : <PiPlay />}
            iconPosition="left"
            loading={pauseResumeLoading}
            onClick={async () => {
              setPauseResumeLoading(true);
              setActionError(null);
              try {
                await apiCall(
                  `/datasource/${dataSource.id}/event-forwarder/${
                    isReady ? "pause" : "resume"
                  }`,
                  { method: "POST" },
                );
                await onRefresh();
              } catch (e) {
                setActionError(
                  e instanceof Error
                    ? e.message
                    : "Could not update the Event Forwarder",
                );
              } finally {
                setPauseResumeLoading(false);
              }
            }}
          >
            {isReady ? "Pause" : "Resume"}
          </Button>
        ) : null}
      </Flex>
      <Text as="p" color="text-mid" mb="0">
        GrowthBook routes SDK events to your warehouse. Pause stops new events
        from being written. Events already in the warehouse stay where they are.
      </Text>
      {errorMessage ? <Callout status="error">{errorMessage}</Callout> : null}
    </Flex>
  );
}
