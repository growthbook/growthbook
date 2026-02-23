import { useMemo, useRef, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineMode,
} from "shared/types/datasource";
import {
  UNITS_TABLE_RETENTION_HOURS_DEFAULT,
  type PipelineValidationResults,
} from "shared/enterprise";
import Checkbox from "@/ui/Checkbox";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useExperiments } from "@/hooks/useExperiments";
import PipelineValidationResultsView from "@/enterprise/components/DataPipeline/PipelineValidationResults";
import { useDataSourcePipelineSettingsValidation } from "@/enterprise/components/DataPipeline/useDataSourcePipelineSettingsValidation";
import Modal from "@/components/Modal";
import RadioGroup from "@/ui/RadioGroup";
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
        initialPipelineSettings?.allowWriting !== true
          ? "disabled"
          : (initialPipelineSettings?.mode ?? "ephemeral"),
      writeDatabase: initialPipelineSettings?.writeDatabase ?? "",
      writeDataset: initialPipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        initialPipelineSettings?.unitsTableRetentionHours ??
        UNITS_TABLE_RETENTION_HOURS_DEFAULT,
      unitsTableDeletion: initialPipelineSettings?.unitsTableDeletion ?? true,
      includedExperimentIds: initialPipelineSettings?.includedExperimentIds,
      applyToAllExperiments:
        initialPipelineSettings?.includedExperimentIds === undefined,
    },
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
        includedExperimentIds: formValues.applyToAllExperiments
          ? undefined
          : formValues.includedExperimentIds,
      },
    });

    return isValid;
  };

  const handleSubmit = async () => {
    const validPermissions = await validatePipelinePermissions();
    if (!validPermissions) {
      return;
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
        includedExperimentIds: formValues.applyToAllExperiments
          ? undefined
          : formValues.includedExperimentIds,
      };
      await onSave(copy);
      onCancel();
    })();
  };

  return (
    <Modal
      open={true}
      header={
        <Text
          size="5"
          weight="bold"
          style={{ color: "var(--color-text-high)" }}
        >
          Edit Pipeline Settings
        </Text>
      }
      showHeaderCloseButton={false}
      bodyClassName="p-0 pb-2 pr-4 ml-0 mx-0"
      trackingEventModalType="edit-data-source-pipeline"
      close={onCancel}
      submit={handleSubmit}
      autoCloseOnSubmit={false}
      borderlessHeader={true}
      useRadixButton={true}
      cta={validateBeforeSaving ? "Validate & Save" : "Save"}
      size="lg"
      includeCloseCta={true}
      closeCta="Cancel"
    >
      <Box mt="4" mb="4" mx="4">
        <Flex direction="column" gap="6">
          <Flex direction="column" gap="3">
            <Text size="3" style={{ color: "var(--color-text-mid)" }}>
              Configure write permissions for GrowthBook in order to improve the
              performance of experiment queries, including incremental refresh.
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
            </>
          ) : null}

          {form.watch("mode") !== "disabled" && (
            <>
              <ValidatePermissionsCheckbox
                value={validateBeforeSaving}
                setValue={setValidateBeforeSaving}
              />

              {validationResults && !allValidationsSucceeded && (
                <ValidationResultsSection
                  validationError={validationError}
                  validationResults={validationResults}
                  validationTableName={validationTableName}
                />
              )}
            </>
          )}
        </Flex>
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
          Retention of temporary units table (hours)
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

function ValidationResultsSection({
  validationError,
  validationResults,
  validationTableName,
}: {
  validationError: string | undefined;
  validationResults: PipelineValidationResults;
  validationTableName: string | undefined;
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <Box ref={sectionRef}>
      <PipelineValidationResultsView
        validationError={validationError}
        results={validationResults}
        tableName={validationTableName}
      />
    </Box>
  );
}
