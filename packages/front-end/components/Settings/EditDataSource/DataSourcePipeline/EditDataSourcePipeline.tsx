import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Box,
  Flex,
  Grid,
  SegmentedControl,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineMode,
} from "back-end/types/datasource";
import { PartitionSettings } from "back-end/src/types/Integration";
import { UNITS_TABLE_RETENTION_HOURS_DEFAULT } from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useExperiments } from "@/hooks/useExperiments";
import PipelineValidationResultsView from "@/enterprise/components/DataPipeline/PipelineValidationResults";
import { useDataSourcePipelineSettingsValidation } from "@/enterprise/components/DataPipeline/useDataSourcePipelineSettingsValidation";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import PipelineQueriesValidationStep from "@/components/Settings/EditDataSource/DataSourcePipeline/PipelineQueriesValidationStep";
import PipelineModeSelector from "./PipelineModeSelector";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

type FormValues = {
  // For the UI we have a disabled option, but it gets mapped to .allowWriting
  mode: "disabled" | DataSourcePipelineMode;
  writeDatabase: string;
  writeDataset: string;
  unitsTableRetentionHours: number;
  unitsTableDeletion: boolean;
  partitionSettings?: PartitionSettings;
  applyToAllExperiments: boolean;
  includedExperimentIds?: string[];
};

export const EditDataSourcePipeline = ({
  dataSource,
  onSave,
  onCancel,
}: EditDataSourcePipelineProps) => {
  const pathNames = dataSourcePathNames(dataSource.type);

  const [validateBeforeSaving, setValidateBeforeSaving] = useState(true);
  const { validate, validationError, validationResults, validationTableName } =
    useDataSourcePipelineSettingsValidation();
  const allValidationsSucceeded =
    validationResults &&
    Object.values(validationResults).every(
      (result) => result.result === "success",
    );

  const { experiments: allExperiments } = useExperiments(
    undefined,
    false,
    "standard",
  );
  const experimentOptions = useMemo(
    () =>
      (allExperiments || [])
        .filter((e) => e.datasource === dataSource.id)
        .map((e) => ({ value: e.id, label: e.name })),
    [allExperiments, dataSource.id],
  );

  const initialPipelineSettings = dataSource.settings.pipelineSettings;
  const form = useForm<FormValues>({
    defaultValues: {
      mode:
        initialPipelineSettings?.allowWriting === false
          ? "disabled"
          : (initialPipelineSettings?.mode ?? "ephemeral"),
      writeDatabase: initialPipelineSettings?.writeDatabase ?? "",
      writeDataset: initialPipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        initialPipelineSettings?.unitsTableRetentionHours ??
        UNITS_TABLE_RETENTION_HOURS_DEFAULT,
      unitsTableDeletion: initialPipelineSettings?.unitsTableDeletion ?? true,
      partitionSettings: initialPipelineSettings?.partitionSettings,
      includedExperimentIds: initialPipelineSettings?.includedExperimentIds,
      applyToAllExperiments:
        initialPipelineSettings?.includedExperimentIds === undefined,
    },
  });

  const [step, setStep] = useState(
    initialPipelineSettings?.allowWriting &&
      initialPipelineSettings?.partitionSettings
      ? 1
      : 0,
  );

  const handleSubmit = form.handleSubmit(async (formValues) => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    copy.settings.pipelineSettings = {
      allowWriting: formValues.mode !== "disabled",
      mode: formValues.mode === "disabled" ? "ephemeral" : formValues.mode,
      writeDatabase: formValues.writeDatabase,
      writeDataset: formValues.writeDataset,
      unitsTableRetentionHours: formValues.unitsTableRetentionHours,
      unitsTableDeletion: formValues.unitsTableDeletion,
      partitionSettings: formValues.partitionSettings,
      includedExperimentIds: formValues.applyToAllExperiments
        ? undefined
        : formValues.includedExperimentIds,
    };
    await onSave(copy);
  });

  const validatePipelinePermissions = async (): Promise<boolean> => {
    const formValues = form.getValues();
    if (formValues.mode === "disabled" || !validateBeforeSaving) {
      return true;
    }

    const isValid = await validate({
      datasourceId: dataSource.id,
      pipelineSettings: {
        allowWriting: true,
        mode: formValues.mode,
        writeDatabase: formValues.writeDatabase,
        writeDataset: formValues.writeDataset,
        unitsTableRetentionHours: formValues.unitsTableRetentionHours,
        unitsTableDeletion: formValues.unitsTableDeletion,
        partitionSettings: formValues.partitionSettings,
        includedExperimentIds: formValues.applyToAllExperiments
          ? undefined
          : formValues.includedExperimentIds,
      },
    });

    return isValid;
  };

  const shouldShowStep2 =
    form.watch("mode") === "incremental" && !!form.watch("partitionSettings");

  return (
    <PagedModal
      trackingEventModalType=""
      header="Edit Data Source Pipeline Settings"
      close={onCancel}
      submit={handleSubmit}
      cta={
        shouldShowStep2 ? (step === 0 ? "Save and advance" : "Save") : "Save"
      }
      forceCtaText={true}
      size="lg"
      step={step}
      setStep={setStep}
      backButton={true}
      hideNav={!shouldShowStep2}
      secondaryCTA={
        form.watch("mode") !== "disabled" && step === 0 ? (
          <Tooltip
            body={
              "If checked, GrowthBook will simulate a pipeline run using a temporary table to verify permissions and settings before saving."
            }
            style={{ display: "flex" }}
          >
            <Checkbox
              value={validateBeforeSaving}
              setValue={(value) => setValidateBeforeSaving(value)}
              label="Validate permissions before saving"
              mb="0"
            />
          </Tooltip>
        ) : undefined
      }
    >
      <Page
        display="Settings"
        enabled={true}
        validate={async () => {
          const ok = await validatePipelinePermissions();
          if (!ok) throw new Error(validationError || "Validation failed");
          await handleSubmit();
        }}
      >
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              Pipeline Mode
            </Text>
            <PipelineModeSelector
              value={form.watch("mode")}
              setValue={(value) => form.setValue("mode", value)}
              dataSourceType={dataSource.type}
            />
          </Flex>

          {form.watch("mode") !== "disabled" ? (
            <Flex gap="3" align="end">
              <Flex direction="column" gap="1" style={{ flex: 1 }}>
                <Flex align="center" justify="between">
                  <Text>Destination {pathNames.databaseName} </Text>
                  <Badge label="Optional" variant="soft" color="gray" />
                </Flex>
                <TextField.Root
                  size="3"
                  value={form.watch("writeDatabase")}
                  onChange={(e) =>
                    form.setValue("writeDatabase", e.target.value)
                  }
                />
                <Text size="1" color="gray">
                  Leave blank to use the default {pathNames.databaseName}
                </Text>
              </Flex>
              <Flex direction="column" gap="1" style={{ flex: 1 }}>
                <Text>Destination {pathNames.schemaName}</Text>
                <TextField.Root
                  size="3"
                  required
                  value={form.watch("writeDataset")}
                  onChange={(e) =>
                    form.setValue("writeDataset", e.target.value)
                  }
                />
                <Text size="1" color="gray">
                  {`${form.watch("writeDatabase") || "(default)"}.${form.watch("writeDataset") || ""}`}
                </Text>
              </Flex>
            </Flex>
          ) : null}

          {form.watch("mode") === "ephemeral" ? (
            <>
              {dataSource.type === "databricks" ? (
                <Flex>
                  <Flex direction="column" gap="1" style={{ flex: 1 }}>
                    <Flex align="center" justify="between" gap="1">
                      <Text weight="medium">Delete temporary units table?</Text>
                      <Badge label="Recommended" variant="soft" color="gray" />
                    </Flex>

                    <Switch
                      id={"toggle-unitsTableDeletion"}
                      checked={!!form.watch("unitsTableDeletion")}
                      onCheckedChange={(value) => {
                        form.setValue("unitsTableDeletion", value);
                      }}
                    />
                    {!form.watch("unitsTableDeletion") ? (
                      <Text size="1" color="gray">
                        Disabling this will require you to periodically remove
                        temporary tables from your Databricks Warehouse
                      </Text>
                    ) : null}
                  </Flex>
                  <Flex style={{ flex: 1 }} />
                </Flex>
              ) : (
                <Flex direction="column" gap="1">
                  <Text weight="medium">
                    Retention of temporary units table (hours)
                  </Text>
                  <TextField.Root
                    size="3"
                    value={form.watch("unitsTableRetentionHours")}
                    onChange={(e) =>
                      form.setValue(
                        "unitsTableRetentionHours",
                        parseInt(e.target.value, 10),
                      )
                    }
                    type="number"
                    min={1}
                    required
                  />
                  {dataSource.type === "snowflake" ? (
                    <Text size="1" color="gray">
                      Rounded up to nearest day for Snowflake
                    </Text>
                  ) : null}
                </Flex>
              )}
            </>
          ) : null}

          {form.watch("mode") === "incremental" ? (
            <>
              <Flex direction="column" gap="1" style={{ flex: 1 }}>
                <Text weight="medium">Enable for all experiments?</Text>

                <Flex gap="2">
                  <Switch
                    id={"toggle-applyToAllExperiments"}
                    checked={!!form.watch("applyToAllExperiments")}
                    onCheckedChange={(value) => {
                      form.setValue("applyToAllExperiments", value);
                    }}
                  />
                  {!form.watch("applyToAllExperiments") ? (
                    <MultiSelectField
                      value={form.watch("includedExperimentIds") ?? []}
                      onChange={(v) => {
                        form.setValue("includedExperimentIds", v);
                      }}
                      options={experimentOptions}
                      placeholder="Pick experiments to use Pipeline mode with..."
                      containerStyle={{ flex: 1 }}
                    />
                  ) : null}
                </Flex>
              </Flex>
            </>
          ) : null}

          {form.watch("mode") === "incremental" ? (
            <Flex direction="column">
              <Flex align="baseline" gap="1">
                <Text weight="medium">Partition Type</Text>
                <Tooltip body="Use Timestamp if your query returns a single time column; Date if using a date or string column; use Year/Month/Day when you output discrete year, month, and day columns." />
              </Flex>
              <Box>
                <SegmentedControl.Root
                  value={form.watch("partitionSettings")?.type || "none"}
                  onValueChange={(v) => {
                    if (!v || v === "none") {
                      form.setValue("partitionSettings", undefined);
                      return;
                    }
                    if (v === "timestamp") {
                      form.setValue("partitionSettings", {
                        type: "timestamp",
                      });
                    }
                    if (v === "date") {
                      form.setValue("partitionSettings", {
                        type: "date",
                        dateColumn: "",
                      });
                    }
                    if (v === "yearMonthDay") {
                      form.setValue("partitionSettings", {
                        type: "yearMonthDay",
                        yearColumn: "",
                        monthColumn: "",
                        dayColumn: "",
                      });
                    }
                  }}
                >
                  <SegmentedControl.Item value="none">
                    None
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="timestamp">
                    Timestamp
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="date">
                    Date
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="yearMonthDay">
                    Year/Month/Day
                  </SegmentedControl.Item>
                </SegmentedControl.Root>
              </Box>
            </Flex>
          ) : null}

          {form.watch("mode") === "incremental" &&
          form.watch("partitionSettings")?.type === "date" ? (
            <Grid columns="3" gap="2">
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="regular">
                  Date column
                </Text>
                <TextField.Root
                  size="3"
                  required
                  value={form.watch("partitionSettings.dateColumn") || ""}
                  onChange={(e) =>
                    form.setValue(
                      "partitionSettings.dateColumn",
                      e.target.value,
                    )
                  }
                />
              </Flex>
            </Grid>
          ) : null}

          {form.watch("mode") === "incremental" &&
          form.watch("partitionSettings")?.type === "yearMonthDay" ? (
            <Grid columns="3" gap="2">
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="regular">
                  Year column
                </Text>
                <TextField.Root
                  size="3"
                  required
                  value={form.watch("partitionSettings.yearColumn") || ""}
                  onChange={(e) =>
                    form.setValue(
                      "partitionSettings.yearColumn",
                      e.target.value,
                    )
                  }
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="regular">
                  Month column
                </Text>
                <TextField.Root
                  size="3"
                  required
                  value={form.watch("partitionSettings.monthColumn") || ""}
                  onChange={(e) =>
                    form.setValue(
                      "partitionSettings.monthColumn",
                      e.target.value,
                    )
                  }
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="regular">
                  Day column
                </Text>
                <TextField.Root
                  size="3"
                  required
                  value={form.watch("partitionSettings.dayColumn") || ""}
                  onChange={(e) =>
                    form.setValue("partitionSettings.dayColumn", e.target.value)
                  }
                />
              </Flex>
            </Grid>
          ) : null}

          {form.watch("mode") !== "disabled" ? (
            <div className="form-inline flex-column align-items-start mb-4 mt-4">
              {validationResults !== undefined && !allValidationsSucceeded ? (
                <Box mt="3" width="100%">
                  <PipelineValidationResultsView
                    results={validationResults}
                    tableName={validationTableName}
                  />
                </Box>
              ) : null}
            </div>
          ) : null}
        </Flex>
      </Page>

      <Page enabled={shouldShowStep2} display="Update Queries">
        <PipelineQueriesValidationStep
          dataSource={dataSource}
          onSaveDataSource={onSave}
        />
      </Page>
    </PagedModal>
  );
};
