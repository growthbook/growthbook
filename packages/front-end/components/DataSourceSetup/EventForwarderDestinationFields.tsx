import { Box, Grid } from "@radix-ui/themes";
import {
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  suggestDatabricksEventForwarderZerobusEndpoint,
} from "shared/util";
import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
  DataSourceType,
} from "shared/types/datasource";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { DocLink } from "@/components/DocLink";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

export type EventForwarderDestination = {
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
};

export function eventDestinationEntryHint(
  type: DataSourceType | undefined,
  action: "continue" | "test",
): string {
  if (type === "databricks") {
    return `Enter a schema, table prefix, and Zerobus endpoint to ${action}.`;
  }
  const location = type === "bigquery" ? "dataset" : "schema";
  return `Enter a ${location} and table prefix to ${action}.`;
}

export function defaultEventForwarderDestination(
  type: DataSourceType,
): EventForwarderDestination {
  if (type === "snowflake") {
    return {
      location: "GROWTHBOOK_EVENTS",
      tablePrefix: DEFAULT_EVENT_FORWARDER_TABLE_PREFIX.toUpperCase(),
      zerobusEndpoint: "",
    };
  }
  return {
    location: "growthbook_events",
    tablePrefix: DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
    zerobusEndpoint: "",
  };
}

export function eventForwarderDestinationFromDatasource(
  datasource: Partial<DataSourceInterfaceWithParams>,
): EventForwarderDestination {
  const config = datasource.eventForwarderConfig;
  if (config?.sinkType === "bigquery") {
    return {
      location: config.config.dataset,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: "",
    };
  }
  if (config?.sinkType === "snowflake") {
    return {
      location: config.config.schema,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: "",
    };
  }
  if (config?.sinkType === "databricks") {
    return {
      location: config.config.schema,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: config.config.zerobusEndpoint,
    };
  }
  return defaultEventForwarderDestination(datasource.type || "bigquery");
}

export default function EventForwarderDestinationFields({
  type,
  params,
  location,
  tablePrefix,
  zerobusEndpoint,
  onLocationChange,
  onTablePrefixChange,
  onZerobusEndpointChange,
  disabled = false,
  embedded = false,
}: {
  type: DataSourceType;
  params: Partial<DataSourceParams> | undefined;
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
  onLocationChange: (value: string) => void;
  onTablePrefixChange: (value: string) => void;
  onZerobusEndpointChange: (value: string) => void;
  disabled?: boolean;
  embedded?: boolean;
}) {
  const isBigQuery = type === "bigquery";
  const databricksHost =
    type === "databricks"
      ? (params as Partial<DatabricksConnectionParams> | undefined)?.host
      : undefined;
  const locationLabel = isBigQuery ? "Dataset" : "Schema";

  const fields = (
    <>
      {embedded ? null : (
        <Heading as="h3" size="md" mb="3">
          Event Destination
        </Heading>
      )}
      <Grid columns={{ initial: "1", sm: "2" }} gap="3">
        <TextField
          label={locationLabel}
          name="eventForwarderDestination"
          required
          markRequired
          value={location}
          onChange={(e) => onLocationChange(e.target.value)}
          disabled={disabled}
          placeholder={
            type === "snowflake" ? "GROWTHBOOK_EVENTS" : "growthbook_events"
          }
          helpText={
            isBigQuery
              ? "The dataset GrowthBook writes forwarded events to."
              : "The schema GrowthBook writes forwarded events to."
          }
        />
        <TextField
          label="Table prefix"
          name="eventForwarderTablePrefix"
          required
          markRequired
          value={tablePrefix}
          onChange={(e) => onTablePrefixChange(e.target.value)}
          disabled={disabled}
          placeholder={
            type === "snowflake"
              ? DEFAULT_EVENT_FORWARDER_TABLE_PREFIX.toUpperCase()
              : DEFAULT_EVENT_FORWARDER_TABLE_PREFIX
          }
          helpText={
            type === "snowflake"
              ? "GrowthBook creates EVENTS, EXPERIMENT_VIEWED, and FEATURE_USAGE tables using this prefix."
              : "GrowthBook creates events, experiment_viewed, and feature_usage tables using this prefix."
          }
        />
      </Grid>
      {type === "databricks" ? (
        <Box mt="3">
          <TextField
            label="Zerobus endpoint"
            name="eventForwarderZerobusEndpoint"
            required
            markRequired
            value={zerobusEndpoint}
            onChange={(e) => onZerobusEndpointChange(e.target.value)}
            disabled={disabled}
            placeholder={
              suggestDatabricksEventForwarderZerobusEndpoint(databricksHost) ||
              "https://<workspace-id>.zerobus.<region>.cloud.databricks.com"
            }
            helpText={
              <>
                Built from your workspace ID and cloud region.{" "}
                <DocLink docSection="eventForwarderZerobus" useRadix={false}>
                  How to find these
                </DocLink>
              </>
            }
          />
        </Box>
      ) : null}
    </>
  );

  if (embedded) return <Box>{fields}</Box>;
  return <Frame mb="4">{fields}</Frame>;
}

export function EventForwarderDestinationSummary({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  const destination = eventForwarderDestinationFromDatasource(dataSource);
  const locationLabel = dataSource.type === "bigquery" ? "Dataset" : "Schema";

  return (
    <Frame mb="0">
      <Heading as="h2" size="md" mb="1">
        Event Destination
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        GrowthBook writes forwarded events here.
      </Text>
      <Grid columns={{ initial: "1", sm: "2" }} gap="3" maxWidth="480px">
        <Box>
          <Text as="p" size="sm" color="text-mid" mb="1">
            {locationLabel}
          </Text>
          <Text as="p" mb="0">
            {destination.location}
          </Text>
        </Box>
        <Box>
          <Text as="p" size="sm" color="text-mid" mb="1">
            Table prefix
          </Text>
          <Text as="p" mb="0">
            {destination.tablePrefix}
          </Text>
        </Box>
        {dataSource.type === "databricks" ? (
          <Box style={{ gridColumn: "1 / -1" }}>
            <Text as="p" size="sm" color="text-mid" mb="1">
              Zerobus endpoint
            </Text>
            <Text as="p" mb="0">
              {destination.zerobusEndpoint}
            </Text>
          </Box>
        ) : null}
      </Grid>
    </Frame>
  );
}
