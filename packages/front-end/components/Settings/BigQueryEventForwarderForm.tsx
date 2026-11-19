import { FC } from "react";
import { Box, Grid } from "@radix-ui/themes";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import TextField from "@/ui/TextField";

const BigQueryEventForwarderForm: FC<{
  eventForwarderConfig: EventForwarderConfigDraft;
  setEventForwarderConfig: (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => void;
}> = ({ eventForwarderConfig, setEventForwarderConfig }) => {
  const bigQueryEventForwarderConfig =
    eventForwarderConfig.sinkType === "bigquery" ? eventForwarderConfig : null;

  if (!bigQueryEventForwarderConfig) return null;

  const updateConfig = (
    patch: Partial<typeof bigQueryEventForwarderConfig.config>,
  ) => {
    setEventForwarderConfig({
      ...bigQueryEventForwarderConfig,
      config: {
        ...bigQueryEventForwarderConfig.config,
        ...patch,
      },
    });
  };

  return (
    <Grid columns="2" gap="4" align="start">
      <TextField
        label="Project"
        name="eventForwarderBigQueryProject"
        value={bigQueryEventForwarderConfig.config.projectId}
        onChange={(e) => updateConfig({ projectId: e.target.value })}
        placeholder="my-project"
        required
      />
      <TextField
        label="Dataset"
        name="eventForwarderBigQueryDataset"
        value={bigQueryEventForwarderConfig.config.dataset}
        onChange={(e) => updateConfig({ dataset: e.target.value })}
        placeholder="my_dataset"
        required
      />
      <Box gridColumn="1 / -1">
        <TextField
          label="Table prefix (optional)"
          name="eventForwarderBigQueryTablePrefix"
          value={bigQueryEventForwarderConfig.config.tablePrefix}
          onChange={(e) => updateConfig({ tablePrefix: e.target.value })}
          placeholder="gb"
          helpText="GrowthBook creates events, experiment_viewed, and feature_usage tables using this prefix."
        />
      </Box>
    </Grid>
  );
};

export default BigQueryEventForwarderForm;
