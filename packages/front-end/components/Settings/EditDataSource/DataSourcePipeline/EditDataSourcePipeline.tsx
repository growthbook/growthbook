import { useMemo, useRef, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Grid, Separator, Text, TextField } from "@radix-ui/themes";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineMode,
} from "back-end/types/datasource";
import { PartitionSettings } from "back-end/src/types/Integration";
import {
  UNITS_TABLE_RETENTION_HOURS_DEFAULT,
  type PipelineValidationResults,
} from "shared/enterprise";
import { PiArrowLeft, PiCaretRight } from "react-icons/pi";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useExperiments } from "@/hooks/useExperiments";
import PipelineValidationResultsView from "@/enterprise/components/DataPipeline/PipelineValidationResults";
import { useDataSourcePipelineSettingsValidation } from "@/enterprise/components/DataPipeline/useDataSourcePipelineSettingsValidation";
import Modal from "@/components/Modal";
import PipelineQueriesValidationStep from "@/components/Settings/EditDataSource/DataSourcePipeline/PipelineQueriesValidationStep";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Link from "@/ui/Link";
import PipelineModeSelector from "./PipelineModeSelector";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

type FormValues = {
  // For the UI we have a disabled option, but it gets mapped to settings.allowWriting
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
  const allValidationsSucceeded = !!(
    validationResults &&
    Object.values(validationResults).every(
      (result) => result.result === "success",
    )
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

  const [currentPage, setCurrentPage] = useState(
    initialPipelineSettings?.allowWriting &&
      initialPipelineSettings?.partitionSettings
      ? 1
      : 0,
  );

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

  const has2Pages =
    form.watch("mode") === "incremental" && !!form.watch("partitionSettings");

  const handleSubmit = async () => {
    const validPermissions = await validatePipelinePermissions();
    if (!validPermissions) {
      throw new Error(validationError || "Validation failed");
    }

    await form.handleSubmit(async (formValues) => {
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
    })();

    if (has2Pages && currentPage === 0) {
      setCurrentPage(1);
      return;
    } else {
      // Closes the modal
      onCancel();
    }
  };

  return (
    <Modal
      open={true}
      header={null}
      showHeaderCloseButton={false}
      bodyClassName="p-0 pb-2 pr-4 ml-0 mx-0"
      trackingEventModalType="edit-data-source-pipeline"
      close={onCancel}
      submit={handleSubmit}
      autoCloseOnSubmit={false}
      borderlessHeader={true}
      useRadixButton={true}
      cta={
        has2Pages && currentPage === 0 ? (
          <>
            Next <PiCaretRight />
          </>
        ) : (
          "Save"
        )
      }
      size="lg"
      includeCloseCta={true}
      closeCta="Cancel"
      backCTA={
        has2Pages && currentPage === 1 ? (
          <Link
            weight="medium"
            underline="none"
            onClick={(e) => {
              e.preventDefault();
              setCurrentPage(currentPage - 1);
            }}
          >
            <PiArrowLeft /> Back
          </Link>
        ) : null
      }
    >
      <Box mt="5" mb="4" mx="4">
        {currentPage === 0 ? (
          <Flex direction="column" gap="6">
            <Text
              size="5"
              weight="bold"
              style={{ color: "var(--color-text-high)" }}
            >
              Edit Pipeline Settings
            </Text>

            <Flex direction="column" gap="3">
              <Text size="3" style={{ color: "var(--color-text-mid)" }}>
                Configure write permissions for GrowthBook in order to improve
                the performance of experiment queries, including incremental
                refresh.
              </Text>
              <PipelineModeSelector
                value={form.watch("mode")}
                setValue={(value) => form.setValue("mode", value)}
                dataSourceType={dataSource.type}
              />
            </Flex>

            {form.watch("mode") !== "disabled" ? (
              <>
                <Separator size="4" />
                <DestinationInputs form={form} pathNames={pathNames} />
                <ValidatePermissionsCheckbox
                  value={validateBeforeSaving}
                  setValue={setValidateBeforeSaving}
                />
              </>
            ) : null}

            {form.watch("mode") === "ephemeral" ? (
              <EphemeralRetentionInputs form={form} />
            ) : null}

            {form.watch("mode") === "incremental" ? (
              <>
                <IncrementalScopeSelector
                  form={form}
                  experimentOptions={experimentOptions}
                />
                <PartitionTypeSelect form={form} />
              </>
            ) : null}

            {form.watch("mode") !== "disabled" &&
              validationResults &&
              !allValidationsSucceeded && (
                <ValidationResultsSection
                  validationResults={validationResults}
                  validationTableName={validationTableName}
                />
              )}
          </Flex>
        ) : null}

        {currentPage === 1 ? (
          <PipelineQueriesValidationStep
            dataSource={dataSource}
            onSaveDataSource={onSave}
          />
        ) : null}
      </Box>
    </Modal>
  );
};

function DestinationInputs({
  form,
  pathNames,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  pathNames: ReturnType<typeof dataSourcePathNames>;
}) {
  return (
    <Flex gap="4" align="start">
      <Flex direction="column" gap="1" style={{ flex: 1 }}>
        <Text size="3" weight="bold">
          Destination {pathNames.databaseName}
        </Text>
        <Text size="3" mb="1">
          Optional—leave blank to use default {pathNames.databaseName}
        </Text>
        <TextField.Root
          size="3"
          placeholder=""
          value={form.watch("writeDatabase")}
          onChange={(e) => form.setValue("writeDatabase", e.target.value)}
        />
      </Flex>

      <Flex direction="column" gap="1" style={{ flex: 1 }}>
        <Text size="3" weight="bold">
          Destination {pathNames.schemaName}
        </Text>
        <Text size="3" mb="1">
          {form.watch("writeDatabase") || "(default)"}.
          {form.watch("writeDataset")}
        </Text>
        <TextField.Root
          size="3"
          required
          value={form.watch("writeDataset")}
          onChange={(e) => form.setValue("writeDataset", e.target.value)}
        />
      </Flex>
    </Flex>
  );
}

function ValidatePermissionsCheckbox({
  value,
  setValue,
}: {
  value: boolean;
  setValue: (v: boolean) => void;
}) {
  return (
    <Checkbox
      labelSize="3"
      label="Validate permissions before saving"
      description="Verify that GrowthBook can write to your Data Source before exiting this modal"
      value={value}
      setValue={setValue}
    />
  );
}

function EphemeralRetentionInputs({
  form,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  return (
    <Box>
      <Flex direction="column" gap="2">
        <Text size="3" weight="bold">
          Retention of temporary units table
        </Text>
        <Flex direction="column" gap="2">
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
          <Flex justify="end">
            <HelperText status="info">hour(s)</HelperText>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}

function IncrementalScopeSelector({
  form,
  experimentOptions,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  experimentOptions: Array<{ value: string; label: string }>;
}) {
  return (
    <Box>
      <RadioGroup
        labelSize="3"
        options={[
          { value: "true", label: "Enable for all Experiments" },
          { value: "false", label: "Enable for specific Experiments" },
        ]}
        value={form.watch("applyToAllExperiments") ? "true" : "false"}
        setValue={(v) => form.setValue("applyToAllExperiments", v === "true")}
      />
      {!form.watch("applyToAllExperiments") ? (
        <Box ml="23px">
          <MultiSelectField
            value={form.watch("includedExperimentIds") ?? []}
            onChange={(v) => {
              form.setValue("includedExperimentIds", v);
            }}
            options={experimentOptions}
            placeholder="Pick experiments to use Pipeline mode with..."
            required={true}
          />
        </Box>
      ) : null}
    </Box>
  );
}

function PartitionTypeSelect({
  form,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="1" mt="3">
        <Text weight="medium" size="3">
          Partition Type
        </Text>
        <Tooltip body="Tell us how your data is partitioned to reduce the amount of data scanned." />
      </Flex>
      <Select
        value={form.watch("partitionSettings")?.type || "none"}
        setValue={(v) => {
          if (!v || v === "none") {
            form.setValue("partitionSettings", undefined);
            return;
          }
          if (v === "timestamp") {
            form.setValue("partitionSettings", { type: "timestamp" });
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
        size="3"
        placeholder="Select partition type"
      >
        <SelectItem value="none">None</SelectItem>
        <SelectItem value="timestamp">Timestamp</SelectItem>
        <SelectItem value="date">Date</SelectItem>
        <SelectItem value="yearMonthDay">Year/Month/Day</SelectItem>
      </Select>
      {form.watch("partitionSettings")?.type === "date" ? (
        <DatePartitionInputs form={form} />
      ) : null}
      {form.watch("partitionSettings")?.type === "yearMonthDay" ? (
        <YMDPartitionInputs form={form} />
      ) : null}
    </Flex>
  );
}

function DatePartitionInputs({
  form,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  return (
    <Grid columns="3" gap="2" mt="3">
      <Flex direction="column" gap="1">
        <Text size="3" weight="medium">
          Date column name
        </Text>
        <TextField.Root
          size="3"
          required
          value={form.watch("partitionSettings.dateColumn") || ""}
          onChange={(e) =>
            form.setValue("partitionSettings.dateColumn", e.target.value)
          }
        />
      </Flex>
    </Grid>
  );
}

function YMDPartitionInputs({
  form,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  return (
    <Grid columns="3" gap="2" mt="3">
      <Flex direction="column" gap="1">
        <Text size="3" weight="medium">
          Year column name
        </Text>
        <TextField.Root
          size="3"
          required
          value={form.watch("partitionSettings.yearColumn") || ""}
          onChange={(e) =>
            form.setValue("partitionSettings.yearColumn", e.target.value)
          }
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text size="3" weight="medium">
          Month column name
        </Text>
        <TextField.Root
          size="3"
          required
          value={form.watch("partitionSettings.monthColumn") || ""}
          onChange={(e) =>
            form.setValue("partitionSettings.monthColumn", e.target.value)
          }
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text size="3" weight="medium">
          Day column name
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
  );
}

function ValidationResultsSection({
  validationResults,
  validationTableName,
}: {
  validationResults: PipelineValidationResults;
  validationTableName: string | undefined;
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <Box mt="4" ref={sectionRef}>
      <Text weight="medium" size="3" mb="2">
        Validation Results
      </Text>
      <PipelineValidationResultsView
        results={validationResults}
        tableName={validationTableName}
      />
    </Box>
  );
}
