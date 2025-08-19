import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourcePipelineSettings,
} from "back-end/types/datasource";
import { Text, Container, Flex } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";
import { Select, SelectItem } from "@/components/Radix/Select";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Callout from "@/components/Radix/Callout";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

type FormValues = Required<
  Pick<
    DataSourcePipelineSettings,
    | "mode"
    | "allowWriting"
    | "writeDatabase"
    | "writeDataset"
    | "unitsTableRetentionHours"
    | "unitsTableDeletion"
  >
> & {
  partitionSettings?: DataSourcePipelineSettings["partitionSettings"];
};

export const EditDataSourcePipeline: FC<EditDataSourcePipelineProps> = ({
  dataSource,
  onSave,
  onCancel,
}: {
  dataSource: DataSourceInterfaceWithParams;
  onSave: (dataSource: DataSourceInterfaceWithParams) => Promise<void>;
  onCancel: () => void;
}) => {
  if (!dataSource) {
    throw new Error("ImplementationError: dataSource cannot be null");
  }
  const pathNames = dataSourcePathNames(dataSource.type);

  const form = useForm<FormValues>({
    defaultValues: {
      mode: dataSource.settings.pipelineSettings?.mode ?? "temporary",
      allowWriting: dataSource.settings.pipelineSettings?.allowWriting ?? false,
      writeDatabase: dataSource.settings.pipelineSettings?.writeDatabase ?? "",
      writeDataset: dataSource.settings.pipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        dataSource.settings.pipelineSettings?.unitsTableRetentionHours ?? 24,
      unitsTableDeletion:
        dataSource.settings.pipelineSettings?.unitsTableDeletion ?? true,
      partitionSettings:
        dataSource.settings.pipelineSettings?.partitionSettings,
    },
  });

  const { apiCall } = useAuth();
  const [validation, setValidation] = useState<null | {
    create: { success: boolean; error?: string };
    insert: { success: boolean; error?: string };
    drop: { success: boolean; error?: string };
  }>(null);
  const [validationTable, setValidationTable] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { isDirty } = form.formState;

  const hasValidationFailures =
    !!validation &&
    !(
      validation.create.success &&
      validation.insert.success &&
      validation.drop.success
    );

  const modalError: string | null =
    validationError ||
    (hasValidationFailures
      ? [
          "Settings not saved because we encountered errors:\n\n",
          // Always include the status of all three steps
          // Create
          validation!.create.success
            ? "• Create table: Passed"
            : `• Create table: Failed${validation!.create.error ? ` - ${validation!.create.error}` : ""}`,
          // Insert (skipped if create failed)
          !validation!.create.success
            ? "• Insert row: Skipped due to create failure"
            : validation!.insert.success
              ? "• Insert row: Passed"
              : `• Insert row: Failed${validation!.insert.error ? ` - ${validation!.insert.error}` : ""}`,
          // Drop (skipped if create failed)
          !validation!.create.success
            ? "• Drop table: Skipped because table was not created"
            : validation!.drop.success
              ? "• Drop table: Passed"
              : [
                  `• Drop table: Failed${validation!.drop.error ? ` - ${validation!.drop.error}` : ""}`,
                  validationTable
                    ? `• Manual cleanup required: Dropping the table ${validationTable} failed. Please clean it up manually.`
                    : "• Manual cleanup required: test table created during validation",
                ].join("\n"),
        ]
          .filter(Boolean)
          .join("\n")
      : null);

  // Compute user-facing status strings for the three steps
  // Watching form values as needed
  form.watch("allowWriting");
  // Status strings were removed from the UI; keep logic minimal if needed later

  const handleSubmit = form.handleSubmit(async (value) => {
    setValidation(null);
    setValidationTable(null);
    setValidationError(null);
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    // Only include partitionSettings if defined; otherwise remove it
    const { partitionSettings, ...rest } = value;
    const pipelineSettings = {
      ...rest,
      ...(rest.mode === "incremental" && partitionSettings
        ? { partitionSettings }
        : {}),
    };

    // If disabled, skip validation and save directly
    if (!pipelineSettings.allowWriting) {
      copy.settings.pipelineSettings = pipelineSettings;
      await onSave(copy);
      onCancel();
      return;
    }

    // Validate before saving if enabled
    try {
      setValidating(true);
      const resp = await apiCall<{
        status: number;
        table?: string;
        results: {
          create: { success: boolean; error?: string };
          insert: { success: boolean; error?: string };
          drop: { success: boolean; error?: string };
        };
      }>(`/datasource/${dataSource.id}/pipeline-validation`, {
        method: "POST",
        body: JSON.stringify({ pipelineSettings }),
      });
      setValidation(resp.results);
      setValidationTable(resp.table || null);

      const allPassed =
        resp.results.create.success &&
        resp.results.insert.success &&
        resp.results.drop.success;

      if (allPassed) {
        copy.settings.pipelineSettings = pipelineSettings;
        await onSave(copy);
        onCancel();
      }
    } catch (e) {
      setValidationError((e as Error).message || "Validation request failed");
    } finally {
      setValidating(false);
    }
  });

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      submit={handleSubmit}
      close={onCancel}
      autoCloseOnSubmit={false}
      loading={validating}
      error={modalError || undefined}
      ctaEnabled={!validating && (!hasValidationFailures || isDirty)}
      disabledMessage={
        validating
          ? "Validating..."
          : hasValidationFailures && !isDirty
            ? "Fix the configuration to re-run validation"
            : undefined
      }
      size="lg"
      header="Edit Data Source Pipeline Settings"
      cta="Save"
    >
      <Flex align="center" gap="3">
        <Text as="label" size="3" weight="medium" className="mr-2">
          Allow GrowthBook to write tables during experiment analyses?
        </Text>
        <Toggle
          id={"toggle-allowWriting"}
          value={!!form.watch("allowWriting")}
          setValue={(value) => {
            form.setValue("allowWriting", value);
          }}
        />
      </Flex>
      {form.watch("allowWriting") ? (
        <Flex direction="column" gap="3" className="w-100 mb-4 mt-4">
          <Container className="w-100" mb="2">
            <Select
              label="Pipeline Mode"
              value={form.watch("mode")}
              setValue={(v) => {
                const newMode = v as "temporary" | "incremental";
                form.setValue("mode", newMode);
                if (newMode === "temporary") {
                  form.setValue("partitionSettings", undefined);
                }
              }}
            >
              <SelectItem value="incremental">
                Incremental (persist units table)
              </SelectItem>
              <SelectItem value="temporary">
                Temporary (per-analysis)
              </SelectItem>
            </Select>
          </Container>
          <Container className="w-100" mb="2">
            <Text as="label" size="3" weight="medium">
              {`Destination ${pathNames.databaseName} (optional)`}{" "}
              <Tooltip
                body={`If left blank will try to write to default ${pathNames.databaseName}`}
              />
            </Text>
            <Field type="text" {...form.register("writeDatabase")} />
          </Container>
          <Container className="w-100" mb="2">
            <Text as="label" size="3" weight="medium">
              {`Destination ${pathNames.schemaName}`}{" "}
            </Text>
            <Field type="text" required {...form.register("writeDataset")} />
          </Container>
          {dataSource.type === "databricks" ? (
            <>
              <Container className="w-100" mt="2">
                <Flex align="center" gap="3">
                  <Text as="label" size="3" weight="medium">
                    Delete temporary units table (recommended)
                  </Text>
                  <Toggle
                    id={"toggle-unitsTableDeletion"}
                    value={!!form.watch("unitsTableDeletion")}
                    setValue={(value) => {
                      form.setValue("unitsTableDeletion", value);
                    }}
                  />
                </Flex>
              </Container>
              {!form.watch("unitsTableDeletion") ? (
                <Callout status="warning" size="sm">
                  Disabling this will require you to periodically remove
                  temporary tables from your Databricks Warehouse
                </Callout>
              ) : null}
            </>
          ) : form.watch("mode") === "temporary" ? (
            <>
              <Container className="w-100" mb="1">
                <Field
                  label="Retention of temporary units table (hours)"
                  type="number"
                  min={1}
                  {...form.register("unitsTableRetentionHours")}
                />
              </Container>
              {dataSource.type === "snowflake" ? (
                <Callout status="info" size="sm">
                  Rounded up to nearest day for Snowflake
                </Callout>
              ) : null}
            </>
          ) : null}

          {form.watch("mode") === "incremental" ? (
            <>
              <Container className="w-100" mt="2" mb="2">
                <Select
                  label="Partition Type (optional)"
                  value={form.watch("partitionSettings")?.type || "none"}
                  setValue={(v) => {
                    if (!v || v === "none") {
                      // Clear partition settings
                      form.setValue("partitionSettings", undefined);
                      return;
                    }
                    if (v === "timestamp") {
                      form.setValue("partitionSettings", { type: "timestamp" });
                    } else if (v === "yearMonthDate") {
                      const current = form.getValues("partitionSettings");
                      form.setValue("partitionSettings", {
                        type: "yearMonthDate",
                        yearColumn: current?.yearColumn || "",
                        monthColumn: current?.monthColumn || "",
                        dateColumn: current?.dateColumn || "",
                      });
                    }
                  }}
                >
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="timestamp">Timestamp</SelectItem>
                  <SelectItem value="yearMonthDate">Year/Month/Date</SelectItem>
                </Select>
              </Container>
              {form.watch("partitionSettings")?.type === "yearMonthDate" ? (
                <Container className="w-100">
                  <Flex direction="column" gap="2">
                    <Field
                      label="Year column"
                      type="text"
                      required
                      {...form.register("partitionSettings.yearColumn")}
                    />
                    <Field
                      label="Month column"
                      type="text"
                      required
                      {...form.register("partitionSettings.monthColumn")}
                    />
                    <Field
                      label="Date column"
                      type="text"
                      required
                      {...form.register("partitionSettings.dateColumn")}
                    />
                  </Flex>
                </Container>
              ) : null}
            </>
          ) : null}
        </Flex>
      ) : null}
    </Modal>
  );
};
