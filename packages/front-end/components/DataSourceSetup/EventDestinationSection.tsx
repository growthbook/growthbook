import { Grid } from "@radix-ui/themes";
import { DataSourceParams, DataSourceType } from "shared/types/datasource";
import { suggestDatabricksEventForwarderZerobusEndpoint } from "shared/util";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import Field from "@/components/Forms/Field";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import {
  EventDestinationFields,
  eventDestinationDescription,
} from "./eventDestination";

export default function EventDestinationSection({
  type,
  params,
  destination,
  disabled = false,
  onChange,
}: {
  type: DataSourceType;
  params: DataSourceParams | undefined;
  destination: EventDestinationFields;
  disabled?: boolean;
  onChange: (patch: Partial<EventDestinationFields>) => void;
}) {
  const locationLabel = type === "bigquery" ? "Dataset" : "Schema";
  const prefixHelp =
    type === "snowflake"
      ? "GrowthBook creates EVENTS, EXPERIMENT_VIEWED, and FEATURE_USAGE tables using this prefix."
      : "GrowthBook creates events, experiment_viewed, and feature_usage tables using this prefix.";
  const zerobusPlaceholder =
    type === "databricks"
      ? suggestDatabricksEventForwarderZerobusEndpoint(
          (params as Partial<DatabricksConnectionParams> | undefined)?.host,
        )
      : "";

  return (
    <Frame mb="4">
      <Heading as="h3" size="md" mb="2">
        Event Destination
      </Heading>
      <Text as="p" size="sm" color="text-low" mb="4">
        {eventDestinationDescription(type, params)}
      </Text>
      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        <Field
          label={locationLabel}
          name="eventDestinationLocation"
          required
          value={destination.location}
          onChange={(event) => onChange({ location: event.target.value })}
          disabled={disabled}
          containerClassName="mb-0"
          autoComplete="off"
        />
        <Field
          label="Table prefix"
          name="eventDestinationTablePrefix"
          value={destination.tablePrefix}
          onChange={(event) => onChange({ tablePrefix: event.target.value })}
          disabled={disabled}
          containerClassName="mb-0"
          helpText={prefixHelp}
          autoComplete="off"
        />
      </Grid>
      {type === "databricks" && (
        <Field
          label="Zerobus endpoint"
          name="eventDestinationZerobus"
          required
          value={destination.zerobusEndpoint}
          onChange={(event) =>
            onChange({ zerobusEndpoint: event.target.value })
          }
          disabled={disabled}
          placeholder={zerobusPlaceholder || undefined}
          containerClassName="mt-4 mb-0"
          helpText="Zerobus ingest endpoint for this workspace."
          autoComplete="off"
        />
      )}
    </Frame>
  );
}
