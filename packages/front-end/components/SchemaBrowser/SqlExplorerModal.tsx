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
import {
  DataVizConfig,
  SavedQuery,
} from "back-end/src/validators/saved-queries";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { validateSQL } from "@/services/datasources";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Radix/Button";
import { SelectItem } from "@/components/Radix/Select";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
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
import SelectField from "../Forms/SelectField";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

type QueryExecutionResult = {
  results: TestQueryRow[];
  error?: string;
  duration?: string;
  sql?: string;
};

export interface Props {
  close: () => void;
  sql?: string;
  name?: string;
  datasourceId?: string;
  results?: TestQueryRow[];
  dataVizConfig?: DataVizConfig[];
  id?: string;
  mutate: () => void;
}

export default function SqlExplorerModal({
  close,
  sql,
  name,
  datasourceId,
  results,
  dataVizConfig,
  id,
  mutate,
}: Props) {
  const [showDataSourcesPanel, setShowDataSourcesPanel] = useState(true);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState(
    datasourceId || ""
  );
  const [dirty, setDirty] = useState(name ? false : true);
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [
    queryExecution,
    setQueryExecution,
  ] = useState<QueryExecutionResult | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const form = useForm<Omit<SavedQuery, "dateCreated" | "dateUpdated">>({
    defaultValues: {
      name: name || "",
      sql: sql || "",
      dateLastRan: undefined,
      dataVizConfig: dataVizConfig || undefined,
      datasourceId: datasourceId || "",
      results: results || [],
    },
  });

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById, datasources } = useDefinitions();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const datasource = getDatasourceById(selectedDatasourceId);
  const canRunQueries = datasource
    ? permissionsUtil.canRunSqlExplorerQueries(datasource)
    : false;
  const canCreateQueries = datasource
    ? permissionsUtil.canCreateSqlExplorerQueries(datasource)
    : false;
  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;

  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  // Check if the organization has the feature to save queries
  const canSaveQueries = hasCommercialFeature("saveSqlExplorerQueries");

  const canSave: boolean =
    canCreateQueries &&
    canSaveQueries &&
    !!queryExecution?.results &&
    !!form.watch("sql").trim() &&
    dirty;

  const runQuery = useCallback(
    async (sql: string) => {
      setQueryExecution(null);
      validateSQL(sql, []);
      form.setValue("dateLastRan", new Date());
      const res: QueryExecutionResult = await apiCall("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: selectedDatasourceId,
        }),
      });
      return res;
    },
    [apiCall, form, selectedDatasourceId]
  );

  const handleSubmit = async () => {
    setLoading(true);

    // Validate required name field
    const currentName = form.watch("name")?.trim();
    if (!currentName) {
      setLoading(false);
      setIsEditingName(true);
      setTempName("");
      throw new Error("You must enter a name for your query");
    }

    // Validate that the name only contains letters, numbers, hyphens, and underscores
    if (!currentName.match(/^[a-zA-Z0-9_.:|\s-]+$/)) {
      setLoading(false);
      setIsEditingName(true);
      throw new Error(
        "Query name can only contain letters, numbers, hyphens, underscores, and spaces"
      );
    }

    // If it's a new query (no savedQuery.id), always save
    if (!id) {
      try {
        await apiCall("/saved-queries", {
          method: "POST",
          body: JSON.stringify({
            name: currentName,
            sql: form.watch("sql"),
            datasourceId: selectedDatasourceId,
            dateLastRan: form.watch("dateLastRan"),
            results: form.watch("results"),
            dataVizConfig: undefined, // New queries don't have viz config yet
          }),
        });
        mutate();
        close();
      } catch (error) {
        setLoading(false);
        throw new Error("Failed to save the query. Reason: " + error);
      }
      return;
    }

    // If nothing changed, just close without making API call
    if (!dirty) {
      setLoading(false);
      close();
      return;
    }

    // Something changed, so save the updates
    try {
      await apiCall(`/saved-queries/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: currentName,
          sql: form.watch("sql"),
          datasourceId: selectedDatasourceId,
          dateLastRan: form.watch("dateLastRan"),
          dataVizConfig: form.watch("dataVizConfig"),
          results: form.watch("results"),
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
    setDirty(true);
    setIsRunningQuery(true);
    try {
      const res = await runQuery(form.watch("sql"));
      setQueryExecution({
        results: res.results || [],
        error: res.error || "",
        duration: res.duration,
        sql: res.sql,
      });
      // Update the form's results field
      form.setValue("results", res.results || []);
    } catch (e) {
      setQueryExecution({
        results: [],
        error: e.message,
        sql: form.watch("sql"),
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

  // Pre-fill results if we're editing a saved query with existing results
  useEffect(() => {
    if (results && results.length > 0) {
      setQueryExecution({
        results,
        sql,
      });
    }
  }, [results, sql]);

  return (
    <Modal
      bodyClassName="p-0"
      borderlessHeader={true}
      close={close}
      loading={loading}
      closeCta="Close"
      cta="Save & Close"
      ctaEnabled={canSave}
      disabledMessage={
        !canSaveQueries
          ? "Upgrade to Pro and Enterprise plans to save queries."
          : undefined
      }
      header={`${id ? "Update" : "Create"} SQL Query`}
      headerClassName={styles["modal-header-backgroundless"]}
      open={true}
      showHeaderCloseButton={false}
      size="max"
      autoCloseOnSubmit={false}
      submit={async () => await handleSubmit()}
      trackingEventModalType="sql-explorer"
      useRadixButton={true}
    >
      <Box
        px="4"
        pb="2"
        style={{
          // 95vh is the max height of the modal
          // 125px is the height of the header and footer + 2px for the borders
          height: "calc(95vh - 127px)",
        }}
      >
        <Tabs
          defaultValue={dataVizConfig?.length ? "visualization" : "sql"}
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <Flex
            align="center"
            justify="between"
            mb="4"
            style={{ borderBottom: "1px solid var(--gray-a6)" }}
          >
            <TabsList>
              <TabsTrigger value="sql">
                <Flex align="center" gap="2">
                  {isEditingName ? (
                    <Flex align="center" gap="2">
                      <input
                        type="text"
                        value={tempName}
                        placeholder="Enter a name..."
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
                            setDirty(true);
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
                          setDirty(true);
                          form.setValue("name", tempName);
                          setIsEditingName(false);
                        }}
                      >
                        <FaCheck color="var(--accent-11)" />
                      </Button>
                    </Flex>
                  ) : (
                    <>
                      {form.watch("name") || "Untitled Query..."}
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
            </TabsList>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setShowDataSourcesPanel(!showDataSourcesPanel)}
            >
              <PiCaretDoubleRight
                style={{
                  transform: showDataSourcesPanel
                    ? "rotate(0deg)"
                    : "rotate(180deg)",
                  transition: "transform 0.5s ease",
                }}
              />
            </Button>
          </Flex>
          <TabsContent value="sql" style={{ flex: 1 }}>
            <PanelGroup direction="horizontal">
              <Panel defaultSize={60}>
                <PanelGroup direction="vertical">
                  <Panel defaultSize={queryExecution ? 30 : 100} minSize={7}>
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
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={handleFormatClick}
                              disabled={!form.watch("sql") || !canFormat}
                            >
                              Format
                            </Button>
                            <Tooltip
                              content={
                                selectedDatasourceId === ""
                                  ? "Select a Data Dource to run your query"
                                  : !canRunQueries
                                  ? "You do not have permission to query the selected Data Source"
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
                                Run
                              </Button>
                            </Tooltip>
                          </Flex>
                        </Flex>
                      }
                    >
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
                          setDirty(true);
                        }}
                        placeholder="Select a Data Source to get started..."
                        helpText={""}
                        fullHeight
                        setCursorData={setCursorData}
                        onCtrlEnter={handleQuery}
                        resizeDependency={!!queryExecution}
                      />
                    </AreaWithHeader>
                  </Panel>
                  {queryExecution && (
                    <>
                      <PanelResizeHandle />
                      <Panel minSize={10}>
                        <DisplayTestQueryResults
                          duration={parseInt(queryExecution.duration || "0")}
                          results={queryExecution.results}
                          sql={queryExecution.sql || ""}
                          error={queryExecution.error || ""}
                          allowDownload={true}
                        />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>

              {showDataSourcesPanel ? (
                <>
                  <PanelResizeHandle />
                  <Panel
                    defaultSize={showDataSourcesPanel ? 25 : 0}
                    minSize={20}
                    maxSize={80}
                  >
                    <AreaWithHeader
                      header={
                        <Flex align="center" gap="1">
                          <Text
                            weight="bold"
                            style={{ color: "var(--color-text-mid)" }}
                          >
                            Data Sources
                          </Text>
                        </Flex>
                      }
                    >
                      <Flex direction="column" height="100%" px="4" py="5">
                        <SelectField
                          className="mb-2"
                          value={selectedDatasourceId}
                          onChange={(value) => {
                            setDirty(true);
                            setSelectedDatasourceId(value);
                          }}
                          options={validDatasources.map((d) => ({
                            value: d.id,
                            label: `${d.name}${
                              d.description ? ` — ${d.description}` : ""
                            }`,
                          }))}
                          placeholder="Select a Data Source..."
                        >
                          {validDatasources.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                              {d.description ? ` — ${d.description}` : ""}
                            </SelectItem>
                          ))}
                        </SelectField>
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
                </>
              ) : null}
            </PanelGroup>
          </TabsContent>
        </Tabs>
      </Box>
    </Modal>
  );
}

// TODO: Find a better name
export function AreaWithHeader({
  backgroundColor = "var(--color-panel-translucent)",
  children,
  header,
  headerStyles = {
    paddingLeft: "12px",
    paddingRight: "12px",
    paddingTop: "12px",
    paddingBottom: "12px",
    borderBottom: "1px solid var(--gray-a3)",
  },
}: {
  backgroundColor?: string;
  children: React.ReactNode;
  header: React.ReactNode;
  headerStyles?: React.CSSProperties;
}) {
  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor,
      }}
    >
      <Box style={headerStyles}>{header}</Box>
      <Box flexGrow="1" style={{ overflow: "hidden", minHeight: 0 }}>
        {children}
      </Box>
    </Flex>
  );
}
