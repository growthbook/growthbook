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
import SelectField from "@/components/Forms/SelectField";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import TextField from "@/ui/TextField";

export type EventForwarderDestination = {
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
  /** Empty or absent means all environments. */
  environment?: string;
};

const ENVIRONMENT_HELP_TEXT =
  "Only events from SDK Connections in this environment are forwarded. Each environment can go to only one Event Forwarder.";

// Why no environment can be picked: another forwarder receives all of them.
// - Names its Data Source when the viewer can read it (`datasources` is readable ones only)
// - undefined when no other forwarder receives all
export function allEnvironmentsTakenMessage(
  claimed: { datasourceId: string; environment: string }[],
  datasources: { id: string; name: string }[],
  ownDatasourceId?: string,
): string | undefined {
  const other = claimed.find(
    (e) => !e.environment && e.datasourceId !== ownDatasourceId,
  );
  if (!other) return undefined;
  const name = datasources.find((d) => d.id === other.datasourceId)?.name;
  return name
    ? `The Event Forwarder on ${name} receives all environments. Set it to one environment first, so events are not sent twice.`
    : "An Event Forwarder you cannot access receives all environments. Ask an admin to set it to one environment first, so events are not sent twice.";
}

// Environment whose events a forwarder receives; "" is all environments.
// - `others`: environments held by the org's other forwarders ("" = all)
// - `savedAll`: this forwarder already receives all, so it may stay that way
// - All is otherwise a choice only for the organization's only forwarder
export function EventForwarderEnvironmentSelect({
  value,
  onChange,
  environments,
  others,
  savedAll = false,
  disabled = false,
  helpText = ENVIRONMENT_HELP_TEXT,
  allTakenMessage = "Another Event Forwarder receives all environments. Set it to one environment first, so events are not sent twice.",
}: {
  value: string;
  onChange: (value: string) => void;
  environments: string[];
  others: string[];
  savedAll?: boolean;
  disabled?: boolean;
  helpText?: string;
  allTakenMessage?: string;
}) {
  const allowAll = !others.length || savedAll;
  return (
    <>
      {others.includes("") && !savedAll ? (
        <Callout status="warning" mb="3">
          {allTakenMessage}
        </Callout>
      ) : null}
      <SelectField
        size="md"
        legacyLabelFormatting={false}
        label="Environment"
        value={value}
        onChange={onChange}
        disabled={disabled}
        initialOption={allowAll ? "All Environments" : undefined}
        placeholder="Select an environment"
        required={!allowAll}
        markRequired={!allowAll}
        options={environments.map((e) => {
          const taken = others.includes(e);
          return {
            // In the label: SelectField options have no working tooltip
            label: taken ? `${e} (used by another Event Forwarder)` : e,
            value: e,
            isDisabled: taken,
          };
        })}
        helpText={helpText}
      />
    </>
  );
}

// Whether a forwarder on this Data Source must pick one: another forwarder
// holds an environment, and this one does not already receive all
export function useEventForwarderEnvironmentRequired(
  datasourceId?: string,
): boolean {
  const { eventForwarderEnvironments } = useDefinitions();
  return (
    eventForwarderEnvironments.some((e) => e.datasourceId !== datasourceId) &&
    !eventForwarderEnvironments.some(
      (e) => e.datasourceId === datasourceId && !e.environment,
    )
  );
}

// For the current organization; pass the Data Source once it exists
export function EventForwarderEnvironmentField({
  value,
  onChange,
  datasourceId,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  datasourceId?: string;
  disabled?: boolean;
}) {
  const environments = useEnvironments();
  const { eventForwarderEnvironments, datasources } = useDefinitions();
  const saved = eventForwarderEnvironments.find(
    (e) => e.datasourceId === datasourceId,
  );
  return (
    <EventForwarderEnvironmentSelect
      value={value}
      onChange={onChange}
      disabled={disabled}
      environments={environments.map((e) => e.id)}
      others={eventForwarderEnvironments
        .filter((e) => e.datasourceId !== datasourceId)
        .map((e) => e.environment)}
      savedAll={!!saved && !saved.environment}
      allTakenMessage={allEnvironmentsTakenMessage(
        eventForwarderEnvironments,
        datasources,
        datasourceId,
      )}
      // Moving a live forwarder to one environment drops the rest on save
      helpText={
        saved && value && value !== saved.environment
          ? `${ENVIRONMENT_HELP_TEXT} Events from other environments stop being forwarded when you save.`
          : undefined
      }
    />
  );
}

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

// connectionSchema null means this warehouse has no connection schema to copy.
export function eventDestinationWithConnectionSchema(
  destination: EventForwarderDestination,
  connectionSchema: string | null,
  locationEdited: boolean,
): EventForwarderDestination {
  if (locationEdited || connectionSchema === null) return destination;
  if (!connectionSchema.trim()) return destination;
  if (destination.location === connectionSchema) return destination;
  return { ...destination, location: connectionSchema };
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
  const environment = config?.environment
    ? { environment: config.environment }
    : {};
  if (config?.sinkType === "bigquery") {
    return {
      location: config.config.dataset,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: "",
      ...environment,
    };
  }
  if (config?.sinkType === "snowflake") {
    return {
      location: config.config.schema,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: "",
      ...environment,
    };
  }
  if (config?.sinkType === "databricks") {
    return {
      location: config.config.schema,
      tablePrefix: config.config.tablePrefix,
      zerobusEndpoint: config.config.zerobusEndpoint,
      ...environment,
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
  environment = "",
  onEnvironmentChange,
  datasourceId,
  disabled = false,
  embedded = false,
  schemaDefaultsToConnection = false,
}: {
  type: DataSourceType;
  params: Partial<DataSourceParams> | undefined;
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
  onLocationChange: (value: string) => void;
  onTablePrefixChange: (value: string) => void;
  onZerobusEndpointChange: (value: string) => void;
  environment?: string;
  onEnvironmentChange: (value: string) => void;
  /** Absent while the Data Source is still being created. */
  datasourceId?: string;
  disabled?: boolean;
  embedded?: boolean;
  /** Snowflake connect form fills an unedited schema from the connection. */
  schemaDefaultsToConnection?: boolean;
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
              : type === "snowflake" && schemaDefaultsToConnection
                ? "Defaults to your connection schema. Use a dedicated schema, such as GROWTHBOOK_EVENTS, if forwarded events should be stored separately."
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
      <Box mt="3">
        <EventForwarderEnvironmentField
          value={environment}
          onChange={onEnvironmentChange}
          datasourceId={datasourceId}
          disabled={disabled}
        />
      </Box>
    </>
  );

  if (embedded) return <Box>{fields}</Box>;
  return <Frame mb="4">{fields}</Frame>;
}
