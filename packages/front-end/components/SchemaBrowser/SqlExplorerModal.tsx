import { useCallback, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  FaPlay,
  FaExclamationTriangle,
  FaCheck,
  FaTimes,
} from "react-icons/fa";
import { PiCaretDoubleRight, PiPencilSimpleFill } from "react-icons/pi";
import { TestQueryRow } from "back-end/src/types/Integration";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Radix/Button";
import { Select, SelectItem } from "@/components/Radix/Select";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
import { convertToCSV, downloadCSVFile } from "@/services/sql";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import Modal from "../Modal";
import SqlExplorerDataVisualization from "../DataViz/SqlExplorerDataVisualization";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export type QueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
  sql?: string;
};

export interface Props {
  close: () => void;
  datasourceId?: string;
  savedQuery?: SavedQuery;
  mutate: () => void;
}

export default function SqlExplorerModal({
  close,
  datasourceId: initialDatasourceId,
  savedQuery,
  mutate,
}: Props) {
  const [selectedDatasourceId, setSelectedDatasourceId] = useState(
    savedQuery?.datasourceId || initialDatasourceId || ""
  );
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [queryResults, setQueryResults] = useState<QueryResults | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const form = useForm({
    defaultValues: {
      name: savedQuery?.name || "",
      sql: savedQuery?.sql || "",
      dateLastRan: savedQuery?.dateLastRan || undefined,
    },
  });

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById, datasources } = useDefinitions();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const datasource = getDatasourceById(selectedDatasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunTestQueries(datasource)
    : null;
  const canSaveQueries = datasource
    ? permissionsUtil.canCreateSavedQueries(datasource)
    : null;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;

  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const canSave: boolean =
    canSaveQueries === true &&
    !!queryResults?.results &&
    !!form.watch("sql").trim();

  const runQuery = useCallback(
    async (sql: string) => {
      setQueryResults(null);
      validateSQL(sql, []);
      form.setValue("dateLastRan", new Date());
      const res: QueryResults = await apiCall("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: selectedDatasourceId,
          limit: 1000,
        }),
      });
      return res;
    },
    [apiCall, form, selectedDatasourceId]
  );

  const handleSubmit = async () => {
    setLoading(true);
    //TODO: Validate form values

    let url = "/saved-queries";
    let method = "POST";
    if (savedQuery?.id) {
      url = `/saved-queries/${savedQuery.id}`;
      method = "PUT";
    }
    try {
      await apiCall(url, {
        method,
        body: JSON.stringify({
          name: form.watch("name"),
          sql: form.watch("sql"),
          datasourceId: selectedDatasourceId,
          dateLastRan: form.watch("dateLastRan"),
          results: queryResults?.results,
        }),
      });
      mutate();
      close();
    } catch (error) {
      setLoading(false);
      throw new Error("Failed to save the query. Reason: " + error);
    }
  };

  const handleQuery = useCallback(async () => {
    setIsRunningQuery(true);
    try {
      const res = await runQuery(form.watch("sql"));
      setQueryResults({ ...res, error: res.error ? res.error : "" });
    } catch (e) {
      setQueryResults({
        sql: form.watch("sql"),
        error: e.message,
        results: [],
      });
    }
    setIsRunningQuery(false);
  }, [form, runQuery]);

  const handleFormatClick = () => {
    const result = formatSql(form.watch("sql"), datasource?.type);
    if (result.error) {
      setFormatError(result.error);
    } else if (result.formattedSql) {
      form.setValue("sql", result.formattedSql);
      setFormatError(null);
    }
  };

  // Filter datasources to only those that support SQL queries
  const validDatasources = datasources.filter(
    (d) => d.type !== "google_analytics"
  );

  function handleDownload(results: TestQueryRow[]) {
    //MKTODO: Add error state rather than alert (just waiting for design to be finalized)
    if (!results.length) {
      alert("No data to export.");
      return;
    }
    const csv = convertToCSV(results);
    if (!csv) {
      alert("No data to export.");
      return;
    }
    downloadCSVFile(csv);
  }

  // Pre-fill results if we're editing a saved query with existing results
  useEffect(() => {
    if (savedQuery?.results && savedQuery.results.length > 0) {
      setQueryResults({
        results: savedQuery.results,
        sql: savedQuery.sql,
      });
    }
  }, [savedQuery]);

  return (
    <Modal
      bodyClassName="p-0"
      borderlessHeader={true}
      close={close}
      loading={loading}
      closeCta="Close"
      cta="Save & Close"
      ctaEnabled={canSave}
      header={`${savedQuery ? "Edit" : "New"} SQL Query`}
      headerClassName={styles["modal-header-backgroundless"]}
      open={true}
      showHeaderCloseButton={false}
      size="max"
      submit={async () => await handleSubmit()}
      trackingEventModalType="sql-explorer"
      useRadixButton={true}
    >
      <Box
        p="4"
        style={{
          // 95vh is the max height of the modal
          // 125px is the height of the header and footer + 2px for the borders
          height: "calc(95vh - 127px)",
        }}
      >
        <Tabs
          defaultValue={savedQuery ? "visualization" : "sql"}
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <TabsList mb="4">
            <TabsTrigger value="sql">
              <Flex align="center" gap="2">
                {isEditingName ? (
                  <Flex align="center" gap="2">
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      style={{
                        padding: "4px 8px",
                        border: "1px solid var(--gray-a6)",
                        borderRadius: "var(--radius-2)",
                        fontSize: "14px",
                        backgroundColor: "var(--color-surface)",
                        color: "var(--color-text-high)",
                        minWidth: "150px",
                      }}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          form.setValue("name", tempName);
                          setIsEditingName(false);
                        } else if (e.key === "Escape") {
                          setTempName(form.watch("name"));
                          setIsEditingName(false);
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTempName(form.watch("name"));
                        setIsEditingName(false);
                      }}
                    >
                      <FaTimes color="var(--gray-11)" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        form.setValue("name", tempName);
                        setIsEditingName(false);
                      }}
                    >
                      <FaCheck color="var(--accent-11)" />
                    </Button>
                  </Flex>
                ) : (
                  <>
                    {form.watch("name") || "New SQL Query"}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTempName(form.watch("name"));
                        setIsEditingName(true);
                      }}
                    >
                      <PiPencilSimpleFill color="var(--accent-11)" />
                    </Button>
                  </>
                )}
              </Flex>
            </TabsTrigger>

            <TabsTrigger value="visualization">Visualization</TabsTrigger>
          </TabsList>

          <TabsContent value="sql" style={{ flex: 1 }}>
            <PanelGroup direction="horizontal">
              <Panel>
                <PanelGroup direction="vertical">
                  <Panel order={1}>
                    <AreaWithHeader
                      header={
                        <Flex align="center" justify="between">
                          <Text
                            weight="bold"
                            style={{ color: "var(--color-text-mid)" }}
                          >
                            SQL
                          </Text>
                          <Flex gap="3">
                            {formatError && (
                              <Tooltip content={formatError}>
                                <span>
                                  <FaExclamationTriangle className="text-danger" />
                                </span>
                              </Tooltip>
                            )}
                            {canFormat ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={handleFormatClick}
                                disabled={!form.watch("sql")}
                              >
                                Format
                              </Button>
                            ) : null}
                            <Tooltip
                              content={
                                selectedDatasourceId === ""
                                  ? "Select a data source to run your query"
                                  : !canRunQueries
                                  ? "You do not have permission to query the selected data source"
                                  : undefined
                              }
                              open={canRunQueries ? false : undefined}
                            >
                              <Button
                                size="xs"
                                onClick={handleQuery}
                                loading={isRunningQuery}
                                disabled={!canRunQueries}
                                icon={<FaPlay />}
                              >
                                Run Query
                              </Button>
                            </Tooltip>
                          </Flex>
                        </Flex>
                      }
                    >
                      <Flex direction="column" height="100%">
                        <CodeTextArea
                          wrapperClassName={styles["sql-editor-wrapper"]}
                          required
                          language="sql"
                          value={form.watch("sql")}
                          setValue={(v) => {
                            if (formatError) {
                              setFormatError(null);
                            }
                            form.setValue("sql", v);
                          }}
                          placeholder="Enter your SQL query here..."
                          helpText={""}
                          fullHeight
                          setCursorData={setCursorData}
                          onCtrlEnter={handleQuery}
                          resizeDependency={!!queryResults}
                        />
                      </Flex>
                    </AreaWithHeader>
                  </Panel>
                  {queryResults && (
                    <>
                      <PanelResizeHandle />
                      <Panel order={2}>
                        <AreaWithHeader
                          header={
                            <Flex align="center" gap="1">
                              <Text weight="bold" size="2">
                                Query Results
                              </Text>
                            </Flex>
                          }
                        >
                          <DisplayTestQueryResults
                            duration={parseInt(queryResults.duration || "0")}
                            results={queryResults.results || []}
                            sql={queryResults.sql || ""}
                            error={queryResults.error || ""}
                            close={() => setQueryResults(null)}
                          />
                        </AreaWithHeader>
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>

              <PanelResizeHandle />

              <Panel defaultSize={25}>
                <AreaWithHeader
                  header={
                    <Flex align="center" gap="1">
                      <Button variant="ghost" size="xs">
                        <PiCaretDoubleRight />
                      </Button>
                      <Text
                        weight="bold"
                        style={{ color: "var(--color-text-high)" }}
                      >
                        Data Sources
                      </Text>
                    </Flex>
                  }
                >
                  <Flex direction="column" height="100%" px="4" py="5">
                    <Select
                      value={selectedDatasourceId}
                      setValue={(value) => setSelectedDatasourceId(value)}
                      placeholder="Select a data source..."
                      size="2"
                    >
                      {validDatasources.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                          {d.description ? ` — ${d.description}` : ""}
                        </SelectItem>
                      ))}
                    </Select>
                    {supportsSchemaBrowser && (
                      <SchemaBrowser
                        updateSqlInput={(sql: string) => {
                          form.setValue("sql", sql);
                        }}
                        datasource={datasource}
                        cursorData={cursorData || undefined}
                      />
                    )}
                  </Flex>
                </AreaWithHeader>
              </Panel>
            </PanelGroup>
          </TabsContent>

          <TabsContent value="visualization" style={{ flex: 1 }}>
            <SqlExplorerDataVisualization rows={queryResults?.results || []} />
          </TabsContent>
        </Tabs>
      </Box>

      {/* <Button
            color="outline-primary"
            className="btn-sm ml-2"
            onClick={() =>
              handleDownload(queryResults?.results || [])
            }
            disabled={!queryResults?.results}
            type="button"
          >
            <span className="pr-2">
              <FaSave />
            </span>
            Download Results
          </Button> */}

      {/* <PanelGroup
        direction="horizontal"
        style={{
        }}
      >
        <Panel>
          <PanelGroup direction="vertical">
            <div className="d-flex flex-column h-100">
              <Panel className="d-flex flex-column h-100">
                <div className="bg-light p-1">
                  <div className="row align-items-center">
                    <div className="col-auto">
                      
                    </div>
                  </div>
                </div>
                {(hasEventName || hasValueCol) && (
                  <div className="bg-light px-3 py-1 border-top form-inline">
                    <div className="row align-items-center">
                      <div className="col-auto">
                        <strong>SQL Template Variables:</strong>
                      </div>
                      {hasEventName && (
                        <div className="col-auto">
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
                                handleQuery();
                              }
                            }}
                          />
                        </div>
                      )}
                      {hasValueCol && (
                        <div className="col-auto">
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
                                handleQuery();
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Panel>
              {queryResults && (
                <>
                  <PanelResizeHandle />
                  <Panel>
                    <DisplayTestQueryResults
                      duration={parseInt(queryResults.duration || "0")}
                      results={queryResults.results || []}
                      sql={queryResults.sql || ""}
                      error={queryResults.error || ""}
                      close={() => setQueryResults(null)}
                    />
                  </Panel>
                </>
              )}
            </div>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle />

        <Panel>
          
        </Panel>
      </PanelGroup> */}
    </Modal>
  );
}

// TODO: Find a better name
function AreaWithHeader({
  children,
  header,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
}) {
  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
      }}
    >
      <Box px="4" py="2" style={{ borderBottom: "1px solid var(--gray-a3)" }}>
        {header}
      </Box>
      <Box flexGrow="1">{children}</Box>
    </Flex>
  );
}
