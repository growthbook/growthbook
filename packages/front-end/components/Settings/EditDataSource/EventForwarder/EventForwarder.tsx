import { useState } from "react";
import { EventForwarderStatus } from "shared/types/event-forwarder";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { Box, Card, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
  onRefresh: () => Promise<void>;
};

const statusLabels: Record<EventForwarderStatus, string> = {
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
  pending: "gray",
  ready: "green",
  paused: "amber",
  error: "red",
  schema_update_error: "red",
};

export default function EventForwarder({
  dataSource,
  canEdit = true,
  onRefresh,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const { apiCall } = useAuth();
  const eventForwarderConfig = dataSource.eventForwarderConfig;

  if (!eventForwarderConfig) return null;

  const tableName =
    "tableName" in eventForwarderConfig.config
      ? eventForwarderConfig.config.tableName
      : "";
  const isReady = eventForwarderConfig.status === "ready";
  const isPaused = eventForwarderConfig.status === "paused";
  const canToggle = canEdit && (isReady || isPaused);
  const action = isReady ? "pause" : "resume";

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="2">
        <Flex align="center" gap="2">
          <Heading as="h3" size="medium" mb="0">
            Event Forwarder
          </Heading>
          <Badge
            label={statusLabels[eventForwarderConfig.status]}
            color={statusColors[eventForwarderConfig.status]}
            variant="soft"
          />
        </Flex>

        {canToggle && (
          <Button
            variant="outline"
            color={isReady ? "red" : "gray"}
            setError={setError}
            style={{
              alignItems: "center",
            }}
            onClick={async () => {
              await apiCall(
                `/datasource/${dataSource.id}/event-forwarder/${action}`,
                {
                  method: "POST",
                },
              );
              await onRefresh();
            }}
          >
            {isReady ? "Pause" : "Resume"}
          </Button>
        )}
      </Flex>

      <p>
        Forward SDK event data from GrowthBook to this datasource for downstream
        analysis and diagnostics.
      </p>

      <Card>
        <Flex direction="column" gap="3" p="2">
          <Flex direction="row" gap="4" align="center" wrap="wrap">
            <Box>
              <Text weight="medium">Table Name: </Text>
              {tableName ? (
                <code>{tableName}</code>
              ) : (
                <Text color="text-low">None</Text>
              )}
            </Box>
            <Box>
              <Text weight="medium">Connector Status: </Text>
              <Text>{statusLabels[eventForwarderConfig.status]}</Text>
            </Box>
          </Flex>

          {eventForwarderConfig.lastProvisioningError ? (
            <Callout status="error" mb="0">
              {eventForwarderConfig.lastProvisioningError}
            </Callout>
          ) : null}
          {error ? (
            <Callout status="error" mb="0">
              {error}
            </Callout>
          ) : null}
        </Flex>
      </Card>
    </Box>
  );
}
