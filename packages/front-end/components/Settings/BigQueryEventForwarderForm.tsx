import { ChangeEventHandler, FC } from "react";
import { Flex } from "@radix-ui/themes";
import { DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME } from "shared/util";
import { DataSourceParams } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import Field from "@/components/Forms/Field";
import Button from "@/components/Button";
import Callout from "@/ui/Callout";
import EventForwarderTableNameField from "./EventForwarderTableNameField";
import { useEventForwarderAccessTest } from "./useEventForwarderAccessTest";

const BigQueryEventForwarderForm: FC<{
  params: Partial<BigQueryConnectionParams>;
  accessTestParams?: Partial<DataSourceParams>;
  eventForwarderConfig: EventForwarderConfigDraft;
  existing: boolean;
  setParams?: (params: { [key: string]: string | boolean }) => void;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  onParamChange?: ChangeEventHandler<HTMLInputElement>;
  datasourceId?: string;
  projects?: string[];
  eventForwarderAccessSignature: string;
  setValidatedEventForwarderSignature?: (signature: string | null) => void;
  showDefaultDatasetField?: boolean;
  className?: string;
}> = ({
  params,
  accessTestParams,
  eventForwarderConfig,
  existing,
  setParams,
  setEventForwarderConfig,
  onParamChange,
  datasourceId,
  projects,
  eventForwarderAccessSignature,
  setValidatedEventForwarderSignature,
  showDefaultDatasetField = false,
  className = "form-group col-md-12 mt-3 px-0",
}) => {
  const bigQueryEventForwarderConfig =
    eventForwarderConfig.sinkType === "bigquery" ? eventForwarderConfig : null;
  const { eventForwarderTestResult, testEventForwarderAccess } =
    useEventForwarderAccessTest({
      existing,
      datasourceId,
      type: "bigquery",
      params: accessTestParams ?? params,
      projects,
      eventForwarderConfig: bigQueryEventForwarderConfig,
      eventForwarderAccessSignature,
      setValidatedEventForwarderSignature,
    });

  if (!bigQueryEventForwarderConfig) return null;

  const canTestEventForwarderAccess =
    !!params.defaultDataset?.trim() &&
    !!bigQueryEventForwarderConfig.config.tableName.trim();

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
      <div>
        <Button
          color="primary"
          disabled={!canTestEventForwarderAccess}
          loadingCta="Testing access"
          onClick={testEventForwarderAccess}
        >
          Test Write Access
        </Button>
      </div>
      {eventForwarderTestResult ? (
        <Callout status={eventForwarderTestResult.status} mt="0" mb="0">
          {eventForwarderTestResult.message}
        </Callout>
      ) : null}
    </Flex>
  );
};

export default BigQueryEventForwarderForm;
