import { ChangeEventHandler, FC } from "react";
import { Flex } from "@radix-ui/themes";
import { DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME } from "shared/util";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import Field from "@/components/Forms/Field";
import EventForwarderTableNameField from "./EventForwarderTableNameField";

const BigQueryEventForwarderForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  eventForwarderConfig: EventForwarderConfigDraft;
  setParams?: (params: { [key: string]: string | boolean }) => void;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  onParamChange?: ChangeEventHandler<HTMLInputElement>;
  showDefaultDatasetField?: boolean;
  className?: string;
}> = ({
  params,
  eventForwarderConfig,
  setParams,
  setEventForwarderConfig,
  onParamChange,
  showDefaultDatasetField = false,
  className = "form-group col-md-12 mt-3 px-0",
}) => {
  const bigQueryEventForwarderConfig =
    eventForwarderConfig.sinkType === "bigquery" ? eventForwarderConfig : null;

  if (!bigQueryEventForwarderConfig) return null;

  return (
    <Flex direction="column" gap="3" className={className}>
      {showDefaultDatasetField ? (
        <Field
          label="Default Dataset"
          type="text"
          className="form-control"
          name="defaultDataset"
          value={params.defaultDataset || ""}
          onChange={(e) => {
            if (setParams) {
              setParams({ defaultDataset: e.target.value });
            } else {
              onParamChange?.(e);
            }
          }}
          placeholder=""
          required
          helpText="Enriched events are written to this BigQuery dataset."
        />
      ) : null}
      <EventForwarderTableNameField
        value={bigQueryEventForwarderConfig.config.tableName}
        onChange={(tableName) =>
          setEventForwarderConfig({
            sinkType: "bigquery",
            config: {
              ...bigQueryEventForwarderConfig.config,
              tableName,
            },
          })
        }
        placeholder={DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME}
        tooltip="Defaults to gb_events. If that table already exists, GrowthBook will reuse it for the event forwarder."
        helpText="Letters, numbers, and underscores (Unicode allowed). Hyphens and spaces are normalized to underscores when saving."
      />
    </Flex>
  );
};

export default BigQueryEventForwarderForm;
