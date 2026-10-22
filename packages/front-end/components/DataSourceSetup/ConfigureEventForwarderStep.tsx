import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useEventForwarderAccessTest } from "@/components/Settings/useEventForwarderAccessTest";
import { useAuth } from "@/services/auth";
import { DEFAULT_DATA_REGION } from "@/services/dataRegions";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { buildEventForwarderConnectDraft } from "./buildEventForwarderConnectDraft";
import EventForwarderDestinationFields, {
  defaultEventForwarderDestination,
  eventForwarderDestinationFromDatasource,
} from "./EventForwarderDestinationFields";

export default function ConfigureEventForwarderStep({
  dataSource,
  canEdit,
  onConfigured,
  onRefresh,
}: {
  dataSource: DataSourceInterfaceWithParams;
  canEdit: boolean;
  onConfigured: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [destination, setDestination] = useState(() =>
    dataSource.eventForwarderConfig?.status === "unconfigured"
      ? defaultEventForwarderDestination(dataSource.type)
      : eventForwarderDestinationFromDatasource(dataSource),
  );
  const [phase, setPhase] = useState<"idle" | "testing" | "configuring">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const region = dataSource.eventForwarderConfig?.region ?? DEFAULT_DATA_REGION;
  const draft = useMemo(
    () =>
      buildEventForwarderConnectDraft({
        type: dataSource.type,
        params: dataSource.params,
        destination,
        region,
      }),
    [dataSource.params, dataSource.type, destination, region],
  );
  const { testEventForwarderAccess } = useEventForwarderAccessTest({
    existing: true,
    datasourceId: dataSource.id,
    type: dataSource.type,
    eventForwarderConfig: draft,
  });

  const persistedError =
    dataSource.eventForwarderConfig?.status === "error"
      ? dataSource.eventForwarderConfig.lastProvisioningError?.trim() || null
      : null;
  const shownError = error ?? persistedError;

  const locationLabel = dataSource.type === "bigquery" ? "dataset" : "schema";
  const missingDestination =
    !destination.location.trim() ||
    !destination.tablePrefix.trim() ||
    (dataSource.type === "databricks" && !destination.zerobusEndpoint.trim());

  const configure = async () => {
    if (!draft || missingDestination || phase !== "idle") return;
    setError(null);
    setPhase("testing");
    try {
      await testEventForwarderAccess();
      setPhase("configuring");
      await apiCall(`/datasource/${dataSource.id}/event-forwarder`, {
        method: "PUT",
        body: JSON.stringify({ eventForwarderConfig: draft }),
      });
      await onConfigured();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not configure the Event Forwarder",
      );
      await onRefresh();
    } finally {
      setPhase("idle");
    }
  };

  return (
    <Box mt="3">
      <EventForwarderDestinationFields
        embedded
        type={dataSource.type}
        params={dataSource.params}
        location={destination.location}
        tablePrefix={destination.tablePrefix}
        zerobusEndpoint={destination.zerobusEndpoint}
        onLocationChange={(location) =>
          setDestination((current) => ({ ...current, location }))
        }
        onTablePrefixChange={(tablePrefix) =>
          setDestination((current) => ({ ...current, tablePrefix }))
        }
        onZerobusEndpointChange={(zerobusEndpoint) =>
          setDestination((current) => ({ ...current, zerobusEndpoint }))
        }
        disabled={!canEdit || phase !== "idle"}
      />
      {shownError ? (
        <Box mt="3">
          <Callout status="error">{shownError}</Callout>
        </Box>
      ) : null}
      <Flex mt="3" align="center" gap="3">
        <Button
          onClick={configure}
          disabled={!canEdit || missingDestination || phase !== "idle"}
          loading={phase !== "idle"}
        >
          {phase === "testing"
            ? "Checking write access"
            : phase === "configuring"
              ? "Configuring"
              : "Configure Event Forwarder"}
        </Button>
      </Flex>
      {missingDestination ? (
        <Box mt="2">
          <Callout status="info">
            {`Enter a ${locationLabel}, table prefix${
              dataSource.type === "databricks" ? ", and Zerobus endpoint" : ""
            } to continue.`}
          </Callout>
        </Box>
      ) : null}
    </Box>
  );
}
