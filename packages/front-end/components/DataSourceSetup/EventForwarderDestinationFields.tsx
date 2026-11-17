import { ReactNode } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiLockSimple } from "react-icons/pi";
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
import { DataRegion } from "@/services/dataRegions";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

export type EventForwarderDestination = {
  location: string;
  tablePrefix: string;
  zerobusEndpoint: string;
  /** Empty or absent means all environments. Saved as a one-item list. */
  environment?: string;
};

const ENVIRONMENT_HELP_TEXT =
  "Only events from SDK Connections in this environment are forwarded. Each environment can go to only one Event Forwarder in each data region.";

// A value fixed at creation, shown as text with a lock instead of an input
export function EventForwarderLockedField({
  label,
  value,
  helpText,
}: {
  label: ReactNode;
  value: string;
  helpText: string;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text as="div" weight="semibold">
        {label}
      </Text>
      <Flex align="center" gap="1">
        <PiLockSimple
          role="img"
          aria-label="Locked"
          color="var(--color-text-mid)"
        />
        <Text>{value}</Text>
      </Flex>
      <Text as="div" size="sm" color="text-mid">
        {helpText}
      </Text>
    </Flex>
  );
}

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
// - `others`: environments held by other forwarders in the same data region ("" = all)
// - `savedAll`: this forwarder already receives all, so it may stay that way
// - All is otherwise a choice only for the region's only forwarder
export function EventForwarderEnvironmentSelect({
  value,
  onChange,
  environments,
  others,
  savedAll = false,
  disabled = false,
  helpText = ENVIRONMENT_HELP_TEXT,
}: {
  value: string;
  onChange: (value: string) => void;
  environments: string[];
  others: string[];
  savedAll?: boolean;
  disabled?: boolean;
  helpText?: string;
}) {
  const allowAll = !others.length || savedAll;
  return (
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
  );
}

// Forwarders sharing a data region, which is where the environment rules apply.
// All regions while the region is still unknown (detected by the connection
// test), so nothing taken is offered as free.
function useEventForwardersInRegion(region?: DataRegion | null) {
  const { eventForwarderEnvironments } = useDefinitions();
  return eventForwarderEnvironments.filter(
    (e) => !region || e.region === region,
  );
}

// Whether a forwarder on this Data Source must pick one: another forwarder in
// its data region holds an environment, and this one does not already receive all
export function useEventForwarderEnvironmentRequired(
  region?: DataRegion | null,
  datasourceId?: string,
): boolean {
  const inRegion = useEventForwardersInRegion(region);
  return (
    inRegion.some((e) => e.datasourceId !== datasourceId) &&
    !inRegion.some((e) => e.datasourceId === datasourceId && !e.environment)
  );
}

// Warning that another forwarder in the region receives all environments
// - Separate from the field, so a caller can give it the full width
// - Nothing while the region is unknown: the forwarder may be in the other one
export function EventForwarderAllTakenCallout({
  region,
  datasourceId,
  mb,
}: {
  region?: DataRegion | null;
  datasourceId?: string;
  mb?: "3";
}) {
  const { datasources } = useDefinitions();
  const inRegion = useEventForwardersInRegion(region);
  if (
    !region ||
    inRegion.some((e) => e.datasourceId === datasourceId && !e.environment)
  ) {
    return null;
  }
  const message = allEnvironmentsTakenMessage(
    inRegion,
    datasources,
    datasourceId,
  );
  return message ? (
    <Callout status="warning" mb={mb}>
      {message}
    </Callout>
  ) : null;
}

// For the current organization; pass the Data Source once it exists.
// Render EventForwarderAllTakenCallout alongside it.
export function EventForwarderEnvironmentField({
  value,
  onChange,
  region,
  datasourceId,
  live = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  region?: DataRegion | null;
  datasourceId?: string;
  // Has received events, so a saved environment can no longer be changed
  live?: boolean;
  disabled?: boolean;
}) {
  const environments = useEnvironments();
  const eventForwarderEnvironments = useEventForwardersInRegion(region);
  // One claim per environment, so a forwarder with several has several
  const own = eventForwarderEnvironments.filter(
    (e) => e.datasourceId === datasourceId,
  );
  const saved = own.map((e) => e.environment).filter(Boolean);
  // Same rule as the server: fixed once live, unless an environment was deleted
  const locked =
    live &&
    saved.length > 0 &&
    saved.every((id) => environments.some((e) => e.id === id));
  if (locked) {
    return (
      <EventForwarderLockedField
        label="Environment"
        value={saved.join(", ")}
        helpText={`${ENVIRONMENT_HELP_TEXT} Set at creation.`}
      />
    );
  }
  return (
    <EventForwarderEnvironmentSelect
      value={value}
      onChange={onChange}
      disabled={disabled}
      environments={environments.map((e) => e.id)}
      others={eventForwarderEnvironments
        .filter((e) => e.datasourceId !== datasourceId)
        .map((e) => e.environment)}
      savedAll={own.length > 0 && !saved.length}
      // Moving a live forwarder to one environment drops the rest on save
      helpText={
        own.length && value && !saved.includes(value)
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
  // Single select for now: the form edits the first one
  const environment = config?.environments?.[0]
    ? { environment: config.environments[0] }
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
  region,
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
  /** Data region of the forwarder; the environment rules apply within it. */
  region?: DataRegion | null;
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
        <EventForwarderAllTakenCallout
          region={region}
          datasourceId={datasourceId}
          mb="3"
        />
        <EventForwarderEnvironmentField
          value={environment}
          onChange={onEnvironmentChange}
          region={region}
          datasourceId={datasourceId}
          disabled={disabled}
        />
      </Box>
    </>
  );

  if (embedded) return <Box>{fields}</Box>;
  return <Frame mb="4">{fields}</Frame>;
}
