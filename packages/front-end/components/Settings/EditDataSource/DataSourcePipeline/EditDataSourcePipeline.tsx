import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
  DataSourcePipelineSettings,
} from "back-end/types/datasource";
import {
  Text,
  Container,
  Flex,
  TextField,
  SegmentedControl,
  Box,
} from "@radix-ui/themes";
import Link from "next/link";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Toggle from "@/components/Forms/Toggle";
import RadioCards from "@/ui/RadioCards";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { dataSourcePathNames } from "./DataSourcePipeline";

type EditDataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

type FormValues = {
  // UI mode adds a Disabled option. Will be mapped on save/validation.
  mode: "disabled" | "temporary" | "incremental";
  writeDatabase: string;
  writeDataset: string;
  unitsTableRetentionHours: number;
  unitsTableDeletion: boolean;
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

  const initialPipelineSettings = dataSource.settings.pipelineSettings;
  const initialEnabledMode: "temporary" | "incremental" =
    initialPipelineSettings?.mode === "incremental"
      ? "incremental"
      : "temporary";
  const [previousEnabledMode, setPreviousEnabledMode] = useState<
    "temporary" | "incremental"
  >(initialEnabledMode);

  const supportsIncrementalMode = useMemo(() => {
    return dataSource.type === "presto" || dataSource.type === "bigquery";
  }, [dataSource.type]);

  const form = useForm<FormValues>({
    defaultValues: {
      mode: (initialPipelineSettings?.allowWriting === false
        ? "disabled"
        : initialPipelineSettings?.mode === "incremental" &&
            !supportsIncrementalMode
          ? "temporary" // Reset to temporary if incremental is not supported
          : (initialPipelineSettings?.mode ?? "temporary")) as
        | "disabled"
        | "temporary"
        | "incremental",
      writeDatabase: initialPipelineSettings?.writeDatabase ?? "",
      writeDataset: initialPipelineSettings?.writeDataset ?? "",
      unitsTableRetentionHours:
        initialPipelineSettings?.unitsTableRetentionHours ?? 24,
      unitsTableDeletion: initialPipelineSettings?.unitsTableDeletion ?? true,
      partitionSettings: initialPipelineSettings?.partitionSettings,
    },
  });

  const { apiCall } = useAuth();
  const [step, setStep] = useState<number>(0);
  const [validation, setValidation] = useState<null | {
    create: { success: boolean; error?: string };
    insert: { success: boolean; error?: string };
    drop: { success: boolean; error?: string };
  }>(null);
  const [validationTable, setValidationTable] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { isDirty: _isDirty } = form.formState;

  // Step 2 state: exposure queries review/edit
  const initialExposureQueries: ExposureQuery[] = useMemo(
    () => dataSource.settings.queries?.exposure || [],
    [dataSource.settings.queries?.exposure],
  );
  const [exposureQueries, setExposureQueries] = useState<ExposureQuery[]>(
    initialExposureQueries,
  );
  const [exposureValidation, setExposureValidation] = useState<
    { id: string; missing: string[]; error?: string }[]
  >([]);
  const [checkingExposure, setCheckingExposure] = useState(false);
  const { factTables, mutateDefinitions, metrics } = useDefinitions();
  const factTablesForDatasource = useMemo(
    () => factTables.filter((t) => t.datasource === dataSource.id),
    [factTables, dataSource.id],
  );
  const [factTableValidation, setFactTableValidation] = useState<
    { id: string; missing: string[]; error?: string }[]
  >([]);
  const [checkingFactTables, setCheckingFactTables] = useState(false);
  const [editFactSqlState, setEditFactSqlState] = useState<null | {
    id: string;
    value: string;
  }>(null);
  const [editSqlState, setEditSqlState] = useState<null | {
    idx: number;
    value: string;
  }>(null);
  const [editExposureState, setEditExposureState] = useState<null | {
    idx: number | null; // null => add
  }>(null);

  const hasValidationFailures =
    !!validation &&
    !(
      validation.create.success &&
      validation.insert.success &&
      validation.drop.success
    );

  const _modalError: string | null =
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

  // Status strings were removed from the UI; keep logic minimal if needed later

  const getRequiredPartitionColumns = useCallback(() => {
    const ps = form.getValues("partitionSettings");
    if (
      form.getValues("mode") === "incremental" &&
      ps?.type === "yearMonthDay"
    ) {
      return [ps.yearColumn, ps.monthColumn, ps.dayColumn].filter(
        Boolean,
      ) as string[];
    }
    return [] as string[];
  }, [form]);

  const validateQueryReturnedColumns = useCallback(
    async (sql: string) => {
      const requiredCols = new Set<string>(getRequiredPartitionColumns());
      if (requiredCols.size === 0) return { missing: [] as string[] };
      try {
        const res = await apiCall<{
          isValid?: boolean;
          results?: { [key: string]: unknown }[];
          duration?: string;
          error?: string;
          sql?: string;
        }>("/query/test", {
          method: "POST",
          body: JSON.stringify({
            query: sql,
            datasourceId: dataSource.id,
            // TODO: Add templateVariables
            validateReturnedColumns: Array.from(requiredCols), // Pass required columns
            limit: 0,
          }),
        });

        if (res.error) {
          if (res.error.includes("Missing columns")) {
            const missing = res.error.split("Missing columns: ")[1].split(", ");
            return {
              missing,
              error: res.error,
            };
          }
          return {
            missing: [],
            error: res.error,
          };
        }
        return { missing: [] };
      } catch (e) {
        return {
          missing: Array.from(requiredCols),
          error: (e as Error).message,
        };
      }
    },
    [apiCall, dataSource.id, getRequiredPartitionColumns],
  );

  const checkAllExposureQueries = useCallback(async () => {
    setCheckingExposure(true);
    const results = await Promise.all(
      exposureQueries.map(async (q) => {
        const r = await validateQueryReturnedColumns(q.query);
        return { id: q.id, ...r };
      }),
    );
    setExposureValidation(results);
    setCheckingExposure(false);
  }, [exposureQueries, validateQueryReturnedColumns]);

  const checkAllFactTables = useCallback(async () => {
    setCheckingFactTables(true);
    const results = await Promise.all(
      factTablesForDatasource.map(async (t) => {
        const r = await validateQueryReturnedColumns(t.sql);
        return { id: t.id, ...r };
      }),
    );
    setFactTableValidation(results);
    setCheckingFactTables(false);
  }, [factTablesForDatasource, validateQueryReturnedColumns]);

  useEffect(() => {
    if (step === 1) {
      // re-check when step 2 opens or partition columns change
      checkAllExposureQueries();
      checkAllFactTables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const allExposureValidated = useMemo(() => {
    if (getRequiredPartitionColumns().length === 0) return true;
    if (exposureQueries.length === 0) return false;
    if (exposureValidation.length !== exposureQueries.length) return false;
    return exposureValidation.every((v) => v.missing.length === 0 && !v.error);
  }, [exposureValidation, exposureQueries.length, getRequiredPartitionColumns]);

  const allFactTablesValidated = useMemo(() => {
    if (getRequiredPartitionColumns().length === 0) return true;
    if (factTablesForDatasource.length === 0) return true;
    if (factTableValidation.length !== factTablesForDatasource.length)
      return false;
    return factTableValidation.every((v) => v.missing.length === 0 && !v.error);
  }, [
    factTableValidation,
    factTablesForDatasource.length,
    getRequiredPartitionColumns,
  ]);

  const regularMetricsForDatasource = useMemo(
    () => (metrics || []).filter((m) => m.datasource === dataSource.id),
    [metrics, dataSource.id],
  );

  // Wizard helpers
  const watchMode = form.watch("mode");
  const watchPartitionSettings = form.watch("partitionSettings");
  const shouldShowStep2 = useMemo(() => {
    return (
      watchMode === "incremental" &&
      watchPartitionSettings?.type === "yearMonthDay"
    );
  }, [watchMode, watchPartitionSettings]);

  const [stagedPipelineSettings, setStagedPipelineSettings] = useState<
    DataSourcePipelineSettings | undefined
  >(undefined);

  // Footer CTA text and status indicator
  const ctaText = useMemo(() => {
    if (step === 0 && shouldShowStep2) return "Validate";
    return "Validate & Save";
  }, [step, shouldShowStep2]);

  const footerStatus = useMemo(() => {
    if (step === 0) {
      if (validating) return { label: "Validating…", color: "gray" as const };
      if (validation) {
        const ok =
          validation.create.success &&
          validation.insert.success &&
          validation.drop.success;
        return ok
          ? { label: "Validated", color: "green" as const }
          : { label: "Errors found", color: "red" as const };
      }
      return { label: "Not validated", color: "gray" as const };
    }
    // Step 1 (queries check)
    const ready =
      !checkingExposure &&
      !checkingFactTables &&
      allExposureValidated &&
      allFactTablesValidated;
    return ready
      ? { label: "Ready to save", color: "green" as const }
      : { label: "Fix queries", color: "amber" as const };
  }, [
    step,
    validating,
    validation,
    checkingExposure,
    checkingFactTables,
    allExposureValidated,
    allFactTablesValidated,
  ]);

  const validateStepOne = form.handleSubmit(async (value) => {
    setValidation(null);
    setValidationTable(null);
    setValidationError(null);
    const { partitionSettings, ...rest } = value;
    const uiMode = rest.mode;
    // Map UI mode to persisted settings
    const pipelineSettings: DataSourcePipelineSettings = {
      mode:
        uiMode === "disabled"
          ? previousEnabledMode
          : (uiMode as "temporary" | "incremental"),
      allowWriting: uiMode === "disabled" ? false : true,
      writeDatabase: rest.writeDatabase,
      writeDataset: rest.writeDataset,
      unitsTableRetentionHours: rest.unitsTableRetentionHours,
      unitsTableDeletion: rest.unitsTableDeletion,
      ...(uiMode === "incremental" && partitionSettings
        ? { partitionSettings }
        : uiMode !== "incremental"
          ? { partitionSettings: undefined }
          : {}),
    } as DataSourcePipelineSettings;

    // If disabled, skip validation and stage directly
    if (uiMode === "disabled") {
      setStagedPipelineSettings(pipelineSettings);
      return;
    }

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
      }>(`/datasource/${dataSource.id}/pipeline/validate`, {
        method: "POST",
        body: JSON.stringify({ pipelineSettings }),
      });
      setValidation(resp.results);
      setValidationTable(resp.table || null);

      const allPassed =
        resp.results.create.success &&
        resp.results.insert.success &&
        resp.results.drop.success;

      if (!allPassed) {
        const errorMsg = [
          "Settings not saved because we encountered errors:\n\n",
          resp.results.create.success
            ? "• Create table: Passed"
            : `• Create table: Failed${resp.results.create.error ? ` - ${resp.results.create.error}` : ""}`,
          !resp.results.create.success
            ? "• Insert row: Skipped due to create failure"
            : resp.results.insert.success
              ? "• Insert row: Passed"
              : `• Insert row: Failed${resp.results.insert.error ? ` - ${resp.results.insert.error}` : ""}`,
          !resp.results.create.success
            ? "• Drop table: Skipped because table was not created"
            : resp.results.drop.success
              ? "• Drop table: Passed"
              : `• Drop table: Failed${resp.results.drop.error ? ` - ${resp.results.drop.error}` : ""}`,
        ]
          .filter(Boolean)
          .join("\n");
        setValidationError(errorMsg);
        throw new Error(errorMsg);
      }

      setStagedPipelineSettings(pipelineSettings);
      setExposureQueries(initialExposureQueries);
    } catch (e) {
      setValidationError((e as Error).message || "Validation request failed");
      throw new Error((e as Error).message || "Validation request failed");
    } finally {
      setValidating(false);
    }
  });

  const finalSubmit = async () => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    const staged = stagedPipelineSettings;
    let toSave: DataSourcePipelineSettings | undefined = staged;
    if (!toSave) {
      const { partitionSettings, ...rest } = form.getValues();
      const uiMode = rest.mode;
      toSave = {
        mode:
          uiMode === "disabled"
            ? previousEnabledMode
            : (uiMode as "temporary" | "incremental"),
        allowWriting: uiMode === "disabled" ? false : true,
        writeDatabase: rest.writeDatabase,
        writeDataset: rest.writeDataset,
        unitsTableRetentionHours: rest.unitsTableRetentionHours,
        unitsTableDeletion: rest.unitsTableDeletion,
        ...(uiMode === "incremental" && partitionSettings
          ? { partitionSettings }
          : uiMode !== "incremental"
            ? { partitionSettings: undefined }
            : {}),
      } as DataSourcePipelineSettings;
    }
    copy.settings.pipelineSettings = toSave;
    // Save updated exposure queries
    copy.settings.queries = copy.settings.queries || {};
    copy.settings.queries.exposure = exposureQueries;
    await onSave(copy);
    onCancel();
  };

  return (
    <PagedModal
      trackingEventModalType="edit-datasource-pipeline"
      header="Edit Data Source Pipeline Settings"
      close={onCancel}
      submit={async () => {
        if (step === 0 && shouldShowStep2) {
          await validateStepOne();
          if (shouldShowStep2) {
            setStep(1);
            return;
          }
        }
        await finalSubmit();
      }}
      size="lg"
      step={step}
      hideNav={!shouldShowStep2}
      setStep={setStep}
      backButton={true}
      cta={ctaText}
      ctaEnabled={
        step === 1
          ? !checkingExposure &&
            !checkingFactTables &&
            allExposureValidated &&
            allFactTablesValidated
          : true
      }
      disabledMessage={
        step === 1 && !(allExposureValidated && allFactTablesValidated)
          ? "Update all queries to include partition columns"
          : undefined
      }
      loading={validating || checkingExposure || checkingFactTables}
      secondaryCTA={
        <div className="d-flex align-items-center text-muted small">
          <span
            className={`badge mr-2 ${
              footerStatus.color === "green"
                ? "badge-success"
                : footerStatus.color === "red"
                  ? "badge-danger"
                  : footerStatus.color === "amber"
                    ? "badge-warning"
                    : "badge-secondary"
            }`}
          >
            ●
          </span>
          {footerStatus.label}
        </div>
      }
    >
      <Page
        display="Settings"
        validate={async () => {
          await validateStepOne();
        }}
      >
        {
          <Flex direction="column" gap="3">
            <Container className="w-100" mb="2">
              <Text as="label" size="3" weight="medium">
                Pipeline Mode
              </Text>
              <RadioCards
                columns="1"
                value={form.watch("mode")}
                setValue={(v) => {
                  const newMode = v as "disabled" | "temporary" | "incremental";
                  const currentMode = form.getValues("mode");
                  if (
                    currentMode !== "disabled" &&
                    (currentMode === "temporary" ||
                      currentMode === "incremental")
                  ) {
                    setPreviousEnabledMode(currentMode);
                  }
                  form.setValue("mode", newMode);
                  if (newMode !== "incremental") {
                    form.setValue("partitionSettings", undefined);
                  }
                }}
                options={[
                  {
                    value: "disabled",
                    label: "Disabled",
                    description: "No tables are written by GrowthBook.",
                  },
                  ...(supportsIncrementalMode
                    ? ([
                        {
                          value: "incremental",
                          label: "Incremental (persist units table)",
                          description:
                            "Keep a units table while the experiment runs; queries hit this table to reduce source scans.",
                          badge: "Recommended",
                        },
                      ] as const)
                    : []),
                  {
                    value: "temporary",
                    label: "Temporary (per-analysis)",
                    description:
                      "Create an ephemeral units table for each validation; removed automatically.",
                  },
                ]}
              />
            </Container>
            {form.watch("mode") !== "disabled" && (
              <>
                <Container className="w-100" mb="2">
                  <Text as="label" size="3" weight="medium">
                    Destination
                  </Text>
                  <Flex gap="3" align="end">
                    <Box style={{ flex: 1 }}>
                      <Flex align="center" justify="between" mb="1">
                        <Text as="label" size="2" weight="regular">
                          {`Destination ${pathNames.databaseName}`}{" "}
                          <Tooltip
                            body={`If left blank will try to write to default ${pathNames.databaseName}`}
                          />
                        </Text>
                        <Badge label="Optional" variant="soft" color="gray" />
                      </Flex>
                      <TextField.Root
                        size="3"
                        placeholder={`e.g. analytics`}
                        value={form.watch("writeDatabase")}
                        onChange={(e) =>
                          form.setValue("writeDatabase", e.target.value)
                        }
                      />
                      <Text size="1" color="gray">
                        Leave blank to use connection default
                      </Text>
                    </Box>
                    <Box style={{ flex: 1 }}>
                      <Text as="label" size="2" weight="regular">
                        {`Destination ${pathNames.schemaName}`}
                      </Text>
                      <TextField.Root
                        size="3"
                        placeholder={`e.g. gbhive`}
                        required
                        value={form.watch("writeDataset")}
                        onChange={(e) =>
                          form.setValue("writeDataset", e.target.value)
                        }
                      />
                      <Text size="1" color="gray">
                        {`${form.watch("writeDatabase") || "(default)"}.${form.watch("writeDataset") || ""}`}
                      </Text>
                    </Box>
                  </Flex>
                </Container>
                <Collapsible
                  trigger={
                    <div className="link-purple font-weight-bold mt-2 mb-1">
                      <PiCaretRightFill className="chevron mr-1" />
                      Advanced
                    </div>
                  }
                  transitionTime={100}
                >
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
                        <Text as="label" size="3" weight="medium">
                          Retention of temporary units table (hours)
                        </Text>
                        <TextField.Root
                          size="3"
                          type="number"
                          min={1}
                          value={String(
                            form.watch("unitsTableRetentionHours") ?? "",
                          )}
                          onChange={(e) =>
                            form.setValue(
                              "unitsTableRetentionHours",
                              Number(e.target.value || 0),
                            )
                          }
                        />
                      </Container>
                      {dataSource.type === "snowflake" ? (
                        <Callout status="info" size="sm">
                          Rounded up to nearest day for Snowflake
                        </Callout>
                      ) : null}
                    </>
                  ) : null}
                </Collapsible>

                {form.watch("mode") === "incremental" ? (
                  <>
                    <Container className="w-100" mt="2" mb="2">
                      <Text as="label" size="3" weight="medium">
                        Partition Type (optional){" "}
                        <Tooltip body="Use Timestamp if your query returns a single time column; use Year/Month/Day when you output discrete year, month, and day columns." />
                      </Text>
                      <Box mt="1">
                        <SegmentedControl.Root
                          value={
                            form.watch("partitionSettings")?.type || "none"
                          }
                          onValueChange={(v) => {
                            if (!v || v === "none") {
                              form.setValue("partitionSettings", undefined);
                              return;
                            }
                            if (v === "timestamp") {
                              form.setValue("partitionSettings", {
                                type: "timestamp",
                              });
                            } else if (v === "yearMonthDay") {
                              const current =
                                form.getValues("partitionSettings");
                              const isYMD =
                                current && current.type === "yearMonthDay";
                              form.setValue(
                                "partitionSettings",
                                {
                                  type: "yearMonthDay",
                                  yearColumn: isYMD
                                    ? (current as Record<string, string>)
                                        .yearColumn || ""
                                    : "",
                                  monthColumn: isYMD
                                    ? (current as Record<string, string>)
                                        .monthColumn || ""
                                    : "",
                                  dayColumn: isYMD
                                    ? (current as Record<string, string>)
                                        .dayColumn || ""
                                    : "",
                                },
                                { shouldDirty: true },
                              );
                            }
                          }}
                        >
                          <SegmentedControl.Item value="none">
                            None
                          </SegmentedControl.Item>
                          <SegmentedControl.Item value="timestamp">
                            Timestamp
                          </SegmentedControl.Item>
                          <SegmentedControl.Item value="yearMonthDay">
                            Year/Month/Day
                          </SegmentedControl.Item>
                        </SegmentedControl.Root>
                      </Box>
                    </Container>
                    {form.watch("partitionSettings")?.type ===
                    "yearMonthDay" ? (
                      <Container className="w-100">
                        <Flex direction="column" gap="2">
                          <div>
                            <Text as="label" size="2" weight="regular">
                              Year column
                            </Text>
                            <TextField.Root
                              size="3"
                              required
                              value={
                                form.watch("partitionSettings.yearColumn") || ""
                              }
                              onChange={(e) =>
                                form.setValue(
                                  "partitionSettings.yearColumn",
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                          <div>
                            <Text as="label" size="2" weight="regular">
                              Month column
                            </Text>
                            <TextField.Root
                              size="3"
                              required
                              value={
                                form.watch("partitionSettings.monthColumn") ||
                                ""
                              }
                              onChange={(e) =>
                                form.setValue(
                                  "partitionSettings.monthColumn",
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                          <div>
                            <Text as="label" size="2" weight="regular">
                              Day column
                            </Text>
                            <TextField.Root
                              size="3"
                              required
                              value={
                                form.watch("partitionSettings.dayColumn") || ""
                              }
                              onChange={(e) =>
                                form.setValue(
                                  "partitionSettings.dayColumn",
                                  e.target.value,
                                )
                              }
                            />
                          </div>
                        </Flex>
                      </Container>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </Flex>
        }
      </Page>
      {form.watch("mode") !== "disabled" && shouldShowStep2 && (
        <Page display="Update Queries">
          <Container className="w-100" mb="2">
            <Text as="p" size="3">
              To use Year/Month/Date partitioning, each Experiment Assignment
              Query must return these columns:
            </Text>
            <div className="mb-2">
              {getRequiredPartitionColumns().map((c) => (
                <code key={c} className="mr-2 border p-1">
                  {c}
                </code>
              ))}
            </div>
            <div className="d-flex align-items-center mb-2">
              <Button
                className="btn-sm mr-2"
                onClick={() => setEditExposureState({ idx: null })}
                type="button"
              >
                Add Exposure Query
              </Button>
              <Button
                className="btn-sm btn-secondary"
                onClick={() => checkAllExposureQueries()}
                type="button"
                disabled={checkingExposure}
              >
                {checkingExposure ? "Checking..." : "Re-check All"}
              </Button>
            </div>
            {exposureQueries.length === 0 ? (
              <Callout status="warning" size="sm">
                No exposure queries found. Add at least one to proceed.
              </Callout>
            ) : null}
          </Container>

          <div className="w-100">
            {exposureQueries.map((q, idx) => {
              const status = exposureValidation.find((v) => v.id === q.id);
              const missing = status?.missing || [];
              const hasError = !!status?.error;
              return (
                <div
                  key={q.id}
                  className="d-flex align-items-center justify-content-between border rounded p-2 mb-2"
                >
                  <div className="d-flex flex-column">
                    <Text size="3" weight="medium">
                      {q.name || q.id}
                    </Text>
                    <Text
                      size="2"
                      color={missing.length || hasError ? "red" : "green"}
                    >
                      {hasError
                        ? `Error testing query: ${status?.error}`
                        : missing.length
                          ? `Missing columns: ${missing.join(", ")}`
                          : "Ready"}
                    </Text>
                  </div>
                  <div>
                    <Button
                      className="btn-sm mr-2"
                      onClick={() => setEditExposureState({ idx })}
                      type="button"
                    >
                      Edit
                    </Button>
                    <Button
                      className="btn-sm btn-secondary"
                      onClick={() =>
                        setEditSqlState({
                          idx,
                          value: exposureQueries[idx].query,
                        })
                      }
                      type="button"
                    >
                      Edit SQL
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <Container className="w-100" mb="2" mt="4">
            <Text as="p" size="3">
              Fact Tables for this Data Source must also include the required
              partition columns:
            </Text>
            <div className="mb-2">
              {getRequiredPartitionColumns().map((c) => (
                <code key={c} className="mr-2 border p-1">
                  {c}
                </code>
              ))}
            </div>
            <div className="d-flex align-items-center mb-2">
              <Button
                className="btn-sm btn-secondary"
                onClick={() => checkAllFactTables()}
                type="button"
                disabled={checkingFactTables}
              >
                {checkingFactTables ? "Checking..." : "Re-check All"}
              </Button>
            </div>
            {factTablesForDatasource.length === 0 ? (
              <Callout status="info" size="sm">
                No fact tables found for this data source.
              </Callout>
            ) : null}
          </Container>

          <div className="w-100">
            {factTablesForDatasource.map((t) => {
              const status = factTableValidation.find((v) => v.id === t.id);
              const missing = status?.missing || [];
              const hasError = !!status?.error;
              return (
                <div
                  key={t.id}
                  className="d-flex align-items-center justify-content-between border rounded p-2 mb-2"
                >
                  <div className="d-flex flex-column">
                    <Text size="3" weight="medium">
                      {t.name || t.id}
                    </Text>
                    <Text
                      size="2"
                      color={missing.length || hasError ? "red" : "green"}
                    >
                      {hasError
                        ? `Error testing query: ${status?.error}`
                        : missing.length
                          ? `Missing columns: ${missing.join(", ")}`
                          : "Ready"}
                    </Text>
                  </div>
                  <div>
                    <Button
                      className="btn-sm btn-secondary"
                      onClick={() =>
                        setEditFactSqlState({ id: t.id, value: t.sql })
                      }
                      type="button"
                    >
                      Edit SQL
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {regularMetricsForDatasource.length > 0 && (
            <Container className="w-100" mb="2" mt="4">
              <Callout status="warning" size="sm">
                The following metrics are defined as regular metrics for this
                data source. They are not compatible with Incremental Refresh
                and using them in experiments will not be optimized. Migrate to
                Fact Tables & Metrics to take full advantage of Incremental
                Refresh.
              </Callout>
              <div className="w-100 mt-2">
                {regularMetricsForDatasource
                  .filter((m) => m.status !== "archived")
                  .map((m) => (
                    <div
                      key={m.id}
                      className="d-flex align-items-center justify-content-between border rounded p-2 mb-2"
                    >
                      <div className="d-flex flex-column">
                        <Text size="3" weight="medium">
                          {m.name}
                        </Text>
                        <Text size="2" color="red">
                          Not compatible with Incremental Refresh
                        </Text>
                      </div>
                      <div>
                        <Link
                          href="/fact-tables"
                          className="btn btn-sm btn-secondary"
                        >
                          Migrate to Fact Metrics
                        </Link>
                      </div>
                    </div>
                  ))}
              </div>
            </Container>
          )}

          {editSqlState && (
            <EditSqlModal
              close={() => setEditSqlState(null)}
              datasourceId={dataSource.id || ""}
              requiredColumns={
                new Set<string>(
                  [
                    "experiment_id",
                    "variation_id",
                    "timestamp",
                    // use this specific query's userIdType
                    exposureQueries[editSqlState.idx]?.userIdType || "",
                    ...getRequiredPartitionColumns(),
                  ].filter(Boolean) as string[],
                )
              }
              value={editSqlState.value}
              save={async (sql: string) => {
                setExposureQueries((prev) => {
                  const copy = [...prev];
                  copy[editSqlState.idx].query = sql;
                  return copy;
                });
                setEditSqlState(null);
                await checkAllExposureQueries();
              }}
            />
          )}

          {editFactSqlState && (
            <EditSqlModal
              close={() => setEditFactSqlState(null)}
              datasourceId={dataSource.id || ""}
              requiredColumns={
                new Set<string>([...getRequiredPartitionColumns()] as string[])
              }
              value={editFactSqlState.value}
              save={async (sql: string) => {
                await apiCall(`/fact-tables/${editFactSqlState.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ sql }),
                });
                await mutateDefinitions();
                setEditFactSqlState(null);
                await checkAllFactTables();
              }}
            />
          )}

          {editExposureState && (
            <AddEditExperimentAssignmentQueryModal
              mode={editExposureState.idx === null ? "add" : "edit"}
              exposureQuery={
                editExposureState.idx === null
                  ? undefined
                  : exposureQueries[editExposureState.idx]
              }
              dataSource={dataSource}
              extraRequiredColumns={getRequiredPartitionColumns()}
              onCancel={() => setEditExposureState(null)}
              onSave={(eq) => {
                setExposureQueries((prev) => {
                  const copy = [...prev];
                  if (editExposureState.idx === null) {
                    copy.push(eq);
                  } else {
                    copy[editExposureState.idx] = eq;
                  }
                  return copy;
                });
                setEditExposureState(null);
                checkAllExposureQueries();
              }}
            />
          )}
        </Page>
      )}
    </PagedModal>
  );
};
