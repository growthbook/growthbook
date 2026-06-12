import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import Field from "@/components/Forms/Field";

const BigQueryEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
  className?: string;
}> = ({
  eventForwarderConfig,
  setEventForwarderConfig,
  className = "form-group col-md-12 mt-3 px-0",
}) => {
  const bigQueryEventForwarderConfig =
    eventForwarderConfig.sinkType === "bigquery" ? eventForwarderConfig : null;

  if (!bigQueryEventForwarderConfig) return null;

  const updateConfig = (
    patch: Partial<typeof bigQueryEventForwarderConfig.config>,
  ) => {
    setEventForwarderConfig({
      sinkType: "bigquery",
      config: {
        ...bigQueryEventForwarderConfig.config,
        ...patch,
      },
    });
  };

  return (
    <Flex direction="column" gap="2" className={className}>
      <Field
        label="Project"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderBigQueryProject"
        value={bigQueryEventForwarderConfig.config.projectId}
        onChange={(e) => updateConfig({ projectId: e.target.value })}
        placeholder="my-project"
        required
      />
      <Field
        label="Dataset"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderBigQueryDataset"
        value={bigQueryEventForwarderConfig.config.dataset}
        onChange={(e) => updateConfig({ dataset: e.target.value })}
        placeholder="my_dataset"
        required
      />
      <Field
        label="Table Prefix (optional)"
        type="text"
        className="form-control"
        containerClassName="mb-0"
        name="eventForwarderBigQueryTablePrefix"
        value={bigQueryEventForwarderConfig.config.tablePrefix}
        onChange={(e) => updateConfig({ tablePrefix: e.target.value })}
        placeholder="gb"
        helpText="GrowthBook creates events, experiment_viewed, and feature_usage tables using this prefix."
      />
    </Flex>
  );
};

export default BigQueryEventForwarderForm;
