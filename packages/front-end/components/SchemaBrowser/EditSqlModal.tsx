import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay, FaExclamationTriangle } from "react-icons/fa";
import {
  InformationSchemaInterfaceWithPaths,
  TestQueryRow,
} from "shared/types/integrations";
import { TemplateVariables } from "shared/types/sql";
import { Flex, Text, Box, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { SQL_ROW_LIMIT } from "shared/sql";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea, { AceCompletion } from "@/components/Forms/CodeTextArea";
import Modal from "@/components/Modal";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import {
  usesEventName,
  usesValueColumn,
} from "@/components/Metrics/MetricForm";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import { getAutoCompletions } from "@/services/sqlAutoComplete";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Checkbox from "@/ui/Checkbox";
import SchemaBrowser from "./SchemaBrowser";
import { AreaWithHeader } from "./SqlExplorerModal";
import styles from "./EditSqlModal.module.scss";

export type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

export interface Props {
  value: string;
  datasourceId: string;
  save: (sql: string) => Promise<void>;
  close: () => void;
  requiredColumns: Set<string>;
  placeholder?: string;
  validateResponseOverride?: (response: TestQueryRow) => void;
  setTemplateVariables?: (templateVariables: TemplateVariables) => void;
  templateVariables?: {
    eventName?: string;
    valueColumn?: string;
  };
  sqlObjectInfo: {
    objectType:
      | "Dimension"
      | "Fact Table"
      | "Identity Join"
      | "Experiment Assignment Query"
      | "Metric"
      | "Segment"
      | "Feature Usage Query";
    objectName?: string;
  };
}

export default function EditSqlModal({
  value,
  save,
  close,
  requiredColumns,
  placeholder = "",
  datasourceId,
  validateResponseOverride,
  templateVariables,
  setTemplateVariables,
  sqlObjectInfo: modalInfo,
}: Props) {
  const [testQueryResults, setTestQueryResults] =
    useState<TestQueryResults | null>(null);
  const [testQueryBeforeSaving, setTestQueryBeforeSaving] = useState(true);
  const [apply5RowLimit, setApply5RowLimit] = useState(true);
  const [autoCompletions, setAutoCompletions] = useState<AceCompletion[]>([]);
  const [informationSchema, setInformationSchema] = useState<
    InformationSchemaInterfaceWithPaths | undefined
  >();
  const [isAutocompleteEnabled, setIsAutocompleteEnabled] = useLocalStorage(
    "sql-editor-autocomplete-enabled",
    true,
  );
  const form = useForm({
    defaultValues: {
      sql: value,
    },
  });

  const { getDatasourceById } = useDefinitions();
  const { apiCall } = useAuth();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const permissionsUtil = usePermissionsUtil();
  const [formatError, setFormatError] = useState<string | null>(null);

  const validateRequiredColumns = useCallback(
    (result: TestQueryRow) => {
      if (!result) return;

      const requiredColumnsArray = Array.from(requiredColumns);
      const missingColumns = requiredColumnsArray.filter(
        (col) => !((col as string) in result),
      );

      if (missingColumns.length > 0) {
        throw new Error(
          `You are missing the following columns: ${missingColumns.join(", ")}`,
        );
      }
    },
    // eslint-disable-next-line
    [Array.from(requiredColumns).join("")],
  );

  const runTestQuery = useCallback(
    async (sql: string) => {
      validateSQL(sql, []);
      setTestQueryResults(null);
      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: datasourceId,
          templateVariables: templateVariables,
          limit: apply5RowLimit ? 5 : undefined,
        }),
      });

      if (res.results?.length) {
        if (validateResponseOverride) {
          validateResponseOverride(res.results[0]);
        } else {
          validateRequiredColumns(res.results[0]);
        }
      }

      return res;
    },
    // eslint-disable-next-line
    [
      apiCall,
      datasourceId,
      validateRequiredColumns,
      validateResponseOverride,
      apply5RowLimit,
      // eslint-disable-next-line
      JSON.stringify(templateVariables),
    ],
  );

  const handleTestQuery = useCallback(async () => {
    setTestingQuery(true);
    const sql = form.getValues("sql");
    try {
      const res = await runTestQuery(sql);
      setTestQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setTestQueryResults({ sql: sql, error: e.message });
    }
    setTestingQuery(false);
  }, [form, runTestQuery]);

  const datasource = getDatasourceById(datasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : null;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;
  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const hasEventName = usesEventName(form.watch("sql"));
  const hasValueCol = usesValueColumn(form.watch("sql"));

  // Update autocompletions when cursor or schema changes
  useEffect(() => {
    const fetchCompletions = async () => {
      if (!isAutocompleteEnabled) {
        setAutoCompletions([]);
        return;
      }
      try {
        const completions = await getAutoCompletions(
          cursorData,
          informationSchema,
          datasource?.type,
          apiCall,
          "EditSqlModal",
          templateVariables?.eventName,
        );
        setAutoCompletions(completions);
      } catch (error) {
        console.error("Failed to fetch autocompletions:", error);
        setAutoCompletions([]);
      }
    };

    // // Debounce: wait 300ms after last change before fetching
    const timeoutId = setTimeout(fetchCompletions, 200);

    // // Cleanup: cancel if dependencies change again
    return () => clearTimeout(timeoutId);
  }, [
    cursorData,
    informationSchema,
    datasource?.type,
    apiCall,
    templateVariables?.eventName,
    isAutocompleteEnabled,
  ]);

  useEffect(() => {
    const fetchSchema = async () => {
      if (!isAutocompleteEnabled) {
        setInformationSchema(undefined);
        return;
      }
      try {
        const response = await apiCall<{
          informationSchema: InformationSchemaInterfaceWithPaths;
        }>(`/datasource/${datasourceId}/schema`);
        setInformationSchema(response.informationSchema);
      } catch (error) {
        console.error("Failed to fetch schema:", error);
        setInformationSchema(undefined);
      }
    };

    fetchSchema();
  }, [datasourceId, apiCall, isAutocompleteEnabled]);

  const handleFormatClick = () => {
    const result = formatSql(form.watch("sql"), datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      form.setValue("sql", result.formattedSql);
      setFormatError(null);
    }
  };

  useEffect(() => {
    if (!canRunQueries) setTestQueryBeforeSaving(false);
  }, [canRunQueries]);

  return (
    <Modal
      trackingEventModalType=""
      open
      header={
        <span>
          Edit SQL for {modalInfo.objectType}
          {modalInfo.objectName && (
            <>
              {" "}
              <i>{modalInfo.objectName}</i>
            </>
          )}
        </span>
      }
      submit={form.handleSubmit(async (value) => {
        if (testQueryBeforeSaving) {
          let res: TestQueryResults;
          try {
            res = await runTestQuery(value.sql);
          } catch (e) {
            setTestQueryResults({ sql: value.sql, error: e.message });
            // Rejecting with a blank error as we handle the error in the
            // DisplayTestQueryResults component rather than in the Modal component
            return Promise.reject(new Error());
          }
          if (res.error) {
            setTestQueryResults(res);
            // Rejecting with a blank error as we handle the error in the
            // DisplayTestQueryResults component rather than in the Modal component
            return Promise.reject(new Error());
          }
        }

        await save(value.sql);
      })}
      close={close}
      size="max"
      overflowAuto={false}
      bodyClassName="p-0"
      cta="Confirm Changes"
      closeCta="Back"
      secondaryCTA={
        <Tooltip
          body="You do not have permission to run test queries"
          shouldDisplay={!canRunQueries}
          tipPosition="top"
        >
          <label className="mx-4 mb-0">
            <input
              type="checkbox"
              disabled={!canRunQueries}
              className="form-check-input"
              checked={testQueryBeforeSaving}
              onChange={(e) => setTestQueryBeforeSaving(e.target.checked)}
            />
            Test query before confirming
          </label>
        </Tooltip>
      }
    >
      <Box p="2" style={{ height: "calc(93vh - 140px)" }}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={supportsSchemaBrowser ? 75 : 100}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={testQueryResults ? 60 : 100} minSize={30}>
                <AreaWithHeader
                  header={
                    <Flex align="center" justify="between">
                      <Text
                        weight="bold"
                        style={{ color: "var(--color-text-mid)" }}
                      >
                        SQL
                      </Text>
                      <Flex gap="3" align="center">
                        {formatError && (
                          <Tooltip body={formatError}>
                            <FaExclamationTriangle className="text-danger" />
                          </Tooltip>
                        )}

                        <Tooltip
                          className="pt-1"
                          shouldDisplay={!!canRunQueries}
                          body={`If unchecked, GrowthBook will automatically apply a ${SQL_ROW_LIMIT} row limit for optimal performance.`}
                        >
                          <Checkbox
                            label="Limit 5"
                            weight="regular"
                            disabled={!canRunQueries}
                            value={apply5RowLimit}
                            setValue={(v) => {
                              setApply5RowLimit(v);
                            }}
                            mb="0"
                          />
                        </Tooltip>
                        {canFormat ? (
                          <RadixButton
                            size="sm"
                            variant="ghost"
                            onClick={handleFormatClick}
                            disabled={!form.watch("sql")}
                          >
                            Format
                          </RadixButton>
                        ) : null}
                        <Tooltip
                          body="You do not have permission to run test queries"
                          shouldDisplay={!canRunQueries}
                        >
                          <Button
                            color="primary"
                            className="btn-sm"
                            onClick={handleTestQuery}
                            loading={testingQuery}
                            disabled={!canRunQueries}
                            type="button"
                          >
                            <span className="pr-2">
                              <FaPlay />
                            </span>
                            Test Query
                          </Button>
                        </Tooltip>
                        <DropdownMenu
                          trigger={
                            <IconButton
                              variant="ghost"
                              color="gray"
                              radius="full"
                              size="3"
                            >
                              <BsThreeDotsVertical size={16} />
                            </IconButton>
                          }
                        >
                          <DropdownMenuItem
                            onClick={() => {
                              setIsAutocompleteEnabled(!isAutocompleteEnabled);
                            }}
                          >
                            {isAutocompleteEnabled
                              ? "Disable Autocomplete"
                              : "Enable Autocomplete"}
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </Flex>
                    </Flex>
                  }
                >
                  <Box style={{ position: "relative", height: "100%" }}>
                    {Array.from(requiredColumns).length > 0 && (
                      <Box
                        p="2"
                        style={{
                          borderBottom: "1px solid var(--gray-a3)",
                          backgroundColor: "var(--slate-a2)",
                        }}
                      >
                        <Text size="2" weight="bold">
                          Required Columns:
                        </Text>
                        {Array.from(requiredColumns).map((col) => (
                          <code
                            className="mx-1 border p-1"
                            key={col}
                            style={{
                              backgroundColor: "var(--gray-a3)",
                              borderRadius: "var(--radius-2)",
                              fontSize: "12px",
                            }}
                          >
                            {col}
                          </code>
                        ))}
                      </Box>
                    )}
                    {setTemplateVariables && (hasEventName || hasValueCol) && (
                      <Box
                        p="2"
                        style={{
                          borderBottom: "1px solid var(--gray-a3)",
                          backgroundColor: "var(--slate-a2)",
                        }}
                      >
                        <Flex align="center" gap="4">
                          <Text size="2" weight="bold">
                            SQL Template Variables:
                          </Text>
                          {hasEventName && (
                            <Field
                              label="eventName"
                              labelClassName="mr-2"
                              value={templateVariables?.eventName || ""}
                              onChange={(e) =>
                                setTemplateVariables({
                                  ...templateVariables,
                                  eventName: e.target.value,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) {
                                  handleTestQuery();
                                }
                              }}
                            />
                          )}
                          {hasValueCol && (
                            <Field
                              label="valueColumn"
                              labelClassName="mr-2"
                              value={templateVariables?.valueColumn || ""}
                              onChange={(e) =>
                                setTemplateVariables({
                                  ...templateVariables,
                                  valueColumn: e.target.value,
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && e.ctrlKey) {
                                  handleTestQuery();
                                }
                              }}
                            />
                          )}
                        </Flex>
                      </Box>
                    )}
                    <CodeTextArea
                      wrapperClassName={styles["sql-editor-wrapper"]}
                      required
                      language="sql"
                      value={form.watch("sql")}
                      setValue={(v) => {
                        if (formatError) {
                          // If there is a format error, clear it when the user changes the SQL
                          setFormatError(null);
                        }
                        form.setValue("sql", v);
                      }}
                      placeholder={placeholder}
                      helpText={""}
                      fullHeight
                      setCursorData={setCursorData}
                      onCtrlEnter={handleTestQuery}
                      completions={autoCompletions}
                    />
                  </Box>
                </AreaWithHeader>
              </Panel>
              {testQueryResults && (
                <>
                  <PanelResizeHandle />
                  <Panel minSize={20}>
                    <DisplayTestQueryResults
                      duration={parseInt(testQueryResults.duration || "0")}
                      results={testQueryResults.results || []}
                      sql={testQueryResults.sql || ""}
                      error={testQueryResults.error || ""}
                      close={() => setTestQueryResults(null)}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
          {supportsSchemaBrowser && (
            <>
              <PanelResizeHandle />
              <Panel defaultSize={25} minSize={20} maxSize={50}>
                <AreaWithHeader
                  header={
                    <Text
                      weight="bold"
                      style={{ color: "var(--color-text-high)" }}
                    >
                      Schema Browser
                    </Text>
                  }
                >
                  <Flex direction="column" height="100%" p="4">
                    <SchemaBrowser
                      updateSqlInput={(sql: string) => {
                        form.setValue("sql", sql);
                      }}
                      datasource={datasource}
                      cursorData={cursorData || undefined}
                    />
                  </Flex>
                  {/* </div> */}
                </AreaWithHeader>
              </Panel>
            </>
          )}
        </PanelGroup>
      </Box>
    </Modal>
  );
}
