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
import { DataRegion, getDataRegionLabel } from "@/services/dataRegions";
import Link from "@/ui/Link";
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

// Says what the current choice forwards
function environmentHelpText(value: string, allowAll: boolean): string {
  if (value) return `Only events from ${value} are forwarded.`;
  return allowAll
    ? "Events from all environments are forwarded."
    : "Only events from the selected environment are forwarded.";
}

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
  helpText,
  markRequired = true,
  allowAll: allowAllOverride,
}: {
  value: string;
  onChange: (value: string) => void;
  environments: string[];
  others: string[];
  savedAll?: boolean;
  disabled?: boolean;
  helpText?: string;
  // Off where the other fields mark "(optional)" instead
  markRequired?: boolean;
  // Replaces the region rule for offering "All Environments"
  allowAll?: boolean;
}) {
  const allowAll = allowAllOverride ?? (!others.length || savedAll);
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
      markRequired={markRequired && !allowAll}
      options={environments.map((e) => {
        const taken = others.includes(e);
        return {
          // In the label: SelectField options have no working tooltip
          label: taken ? `${e} (used by another Event Forwarder)` : e,
          value: e,
          isDisabled: taken,
        };
      })}
      helpText={helpText ?? environmentHelpText(value, allowAll)}
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

// Another forwarder in the region receives all environments, so this one
// can't be set up there
// - Nothing while the region is unknown: the forwarder may be in the other one
export function useEventForwarderAllTakenBy(
  region?: DataRegion | null,
  datasourceId?: string,
): string | undefined {
  const inRegion = useEventForwardersInRegion(region);
  if (
    !region ||
    inRegion.some((e) => e.datasourceId === datasourceId && !e.environment)
  ) {
    return undefined;
  }
  return inRegion.find((e) => !e.environment && e.datasourceId !== datasourceId)
    ?.datasourceId;
}

// Warning for useEventForwarderAllTakenBy
// - Separate from the field, so a caller can give it the full width
// - Links that Data Source in a new tab, so this form keeps what was typed
// - `regionSelectable`: suggests picking the other data region
export function EventForwarderAllTakenCallout({
  region,
  datasourceId,
  regionSelectable = false,
  mb,
}: {
  region?: DataRegion | null;
  datasourceId?: string;
  regionSelectable?: boolean;
  mb?: "3";
}) {
  const { datasources } = useDefinitions();
  const takenBy = useEventForwarderAllTakenBy(region, datasourceId);
  if (!takenBy || !region) return null;
  const name = datasources.find((d) => d.id === takenBy)?.name;
  const where = getDataRegionLabel(region);
  const otherRegion = regionSelectable ? "Choose another data region, or " : "";
  return (
    <Callout status="warning" mb={mb}>
      {name ? (
        <>
          The Event Forwarder on{" "}
          <Link href={`/datasources/${takenBy}#event-forwarder`} external>
            {name}
          </Link>{" "}
          receives all environments in {where}.{" "}
          {otherRegion ? `${otherRegion}set` : "Set"} that Event Forwarder to
          one environment first, so events are not sent twice.
        </>
      ) : (
        <>
          An Event Forwarder you cannot access receives all environments in{" "}
          {where}. {otherRegion ? `${otherRegion}ask` : "Ask"} an admin to set
          it to one environment first, so events are not sent twice.
        </>
      )}
    </Callout>
  );
}

// This forwarder's saved environments in its region
// - `own`: its claims; one per environment, or one "" for all
// - `locked`: same rule as the server, fixed once live unless one was deleted
function useSavedEventForwarderEnvironments(
  region: DataRegion | null | undefined,
  datasourceId: string | undefined,
  live: boolean,
) {
  const environments = useEnvironments();
  const own = useEventForwardersInRegion(region).filter(
    (e) => e.datasourceId === datasourceId,
  );
  const saved = own.map((e) => e.environment).filter(Boolean);
  const locked =
    live &&
    saved.length > 0 &&
    saved.every((id) => environments.some((e) => e.id === id));
  return { own, saved, locked };
}

// Picking `value` drops some of the saved environments ([] is all)
export function narrowsEventForwarderEnvironments(
  saved: string[],
  value: string,
): boolean {
  return !!value && (saved.length !== 1 || saved[0] !== value);
}

// Shared copy for a narrowing that can't be undone
export function EventForwarderNarrowingWarning({
  value,
  action,
  mt,
}: {
  value: string;
  // "change": Super Admin, who can change it again, so no lock sentence
  action: "save" | "change";
  mt?: "3";
}) {
  return (
    <Callout status="warning" mt={mt}>
      After you save, only events from {value} are forwarded.
      {action === "change"
        ? null
        : " This can't be changed later, so set up another Event Forwarder for any other environments you need."}
    </Callout>
  );
}

// Warns when narrowing a live forwarder, which locks it to that environment
// - Not before it receives events, while it can still change
// - Not while the field is locked, since nothing can change
// - Separate from the field, so a caller can give it the full width
export function EventForwarderNarrowingCallout({
  value,
  region,
  datasourceId,
  live,
}: {
  value: string;
  region?: DataRegion | null;
  datasourceId?: string;
  live: boolean;
}) {
  const { own, saved, locked } = useSavedEventForwarderEnvironments(
    region,
    datasourceId,
    live,
  );
  if (
    !live ||
    locked ||
    !own.length ||
    !narrowsEventForwarderEnvironments(saved, value)
  ) {
    return null;
  }
  return <EventForwarderNarrowingWarning value={value} action="save" />;
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
  markRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  region?: DataRegion | null;
  datasourceId?: string;
  // Has received events, so a saved environment can no longer be changed
  live?: boolean;
  disabled?: boolean;
  markRequired?: boolean;
}) {
  const environments = useEnvironments();
  const eventForwarderEnvironments = useEventForwardersInRegion(region);
  const allTakenBy = useEventForwarderAllTakenBy(region, datasourceId);
  const { own, saved, locked } = useSavedEventForwarderEnvironments(
    region,
    datasourceId,
    live,
  );
  if (locked) {
    return (
      <EventForwarderLockedField
        label={saved.length > 1 ? "Environments" : "Environment"}
        value={saved.join(", ")}
        helpText={`Only events from ${saved.join(", ")} are forwarded. Set at creation.`}
      />
    );
  }
  return (
    <EventForwarderEnvironmentSelect
      value={value}
      onChange={onChange}
      // Nothing can be picked while another forwarder receives all
      disabled={disabled || !!allTakenBy}
      markRequired={markRequired}
      environments={environments.map((e) => e.id)}
      others={eventForwarderEnvironments
        .filter((e) => e.datasourceId !== datasourceId)
        .map((e) => e.environment)}
      savedAll={own.length > 0 && !saved.length}
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
