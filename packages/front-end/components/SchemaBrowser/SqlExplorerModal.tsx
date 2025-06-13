import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FaPlay,
  FaExclamationTriangle,
  FaCheck,
  FaTimes,
} from "react-icons/fa";
import { PiCaretDoubleRight, PiPencilSimpleFill } from "react-icons/pi";
import {
  DataVizConfig,
  SavedQuery,
  QueryExecutionResult,
} from "back-end/src/validators/saved-queries";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
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

export interface Props {
  close: () => void;
  sql?: string;
  name?: string;
  initialDatasourceId?: string;
  results?: QueryExecutionResult;
  dateLastRan?: string;
  dataVizConfig?: DataVizConfig[];
  id?: string;
  mutate: () => void;
}

export default function SqlExplorerModal({
  close,
  sql,
  name,
  initialDatasourceId,
  results,
  dataVizConfig,
  dateLastRan,
  id,
  mutate,
}: Props) {
  const [showDataSourcesPanel, setShowDataSourcesPanel] = useState(true);
  const [dirty, setDirty] = useState(name ? false : true);
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const form = useForm<Omit<SavedQuery, "dateCreated" | "dateUpdated">>({
    defaultValues: {
      name: name || "",
      sql: sql || "",
      dateLastRan: getValidDate(dateLastRan) || undefined,
      dataVizConfig: dataVizConfig || undefined,
      datasourceId: initialDatasourceId || "",
      results: results || {
        results: [],
        error: undefined,
        duration: undefined,
        sql: undefined,
      },
    },
  });

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById, datasources } = useDefinitions();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const datasource = getDatasourceById(form.watch("datasourceId"));
  const initialDatasource = initialDatasourceId
    ? getDatasourceById(initialDatasourceId)
    : undefined;

  // If the modal opens with a datasource that the user doesn't have permission to query,
  // we'll show the modal in read only mode
  const readOnlyMode = initialDatasource
    ? !permissionsUtil.canRunSqlExplorerQueries(initialDatasource)
    : false;

  const hasUpdatePermissions = datasource
    ? permissionsUtil.canUpdateSqlExplorerQueries(datasource, {})
    : false;

  const hasCreatePermissions = datasource
    ? permissionsUtil.canCreateSqlExplorerQueries(datasource)
    : false;

  const hasPermission = id ? hasUpdatePermissions : hasCreatePermissions;

  const supportsSchemaBrowser =
    datasource?.properties?.supportsInformationSchema;

  const canFormat = datasource ? canFormatSql(datasource.type) : false;

  const canSave: boolean =
    hasPermission &&
    hasCommercialFeature("saveSqlExplorerQueries") &&
    !!form.watch("sql").trim();

  const runQuery = useCallback(
    async (sql: string) => {
      validateSQL(sql, []);
      form.setValue("dateLastRan", new Date());
      const res = await apiCall<QueryExecutionResult>("/query/run", {
        method: "POST",
        body: JSON.stringify({
          query: sql,
          datasourceId: form.watch("datasourceId"),
          limit: 1000,
        }),
      });
      return res;
    },
    [apiCall, form]
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
            datasourceId: form.watch("datasourceId"),
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
          datasourceId: form.watch("datasourceId"),
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
      const results = await runQuery(form.watch("sql"));
      console.log("results", results);
      // Update the form's results field
      form.setValue("results", {
        results: results.results || [],
        error: results.error,
        duration: results.duration,
        sql: results.sql,
      });
    } catch (e) {
      form.setValue("results", {
        results: [],
        error: e.message,
        sql: form.watch("sql"),
        duration: e.duration || 0,
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
  // Also only show datasources that the user has permission to query
  const validDatasources = datasources.filter(
    (d) =>
      d.type !== "google_analytics" &&
      permissionsUtil.canRunSqlExplorerQueries(d)
  );

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
        !hasCommercialFeature("saveSqlExplorerQueries")
          ? "Upgrade to a Pro or Enterprise plan to save your queries."
          : !hasPermission
          ? "You don't have permission to save this query."
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
                      {!readOnlyMode ? (
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
                      ) : null}
                    </>
                  )}
                </Flex>
              </TabsTrigger>
            </TabsList>
            {!readOnlyMode ? (
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
            ) : null}
          </Flex>
          <TabsContent value="sql" style={{ flex: 1 }}>
            <PanelGroup direction="horizontal">
              <Panel defaultSize={60}>
                <PanelGroup direction="vertical">
                  <Panel
                    defaultSize={form.watch("results").sql ? 30 : 100}
                    minSize={7}
                  >
                    <AreaWithHeader
                      header={
                        <Flex align="center" justify="between">
                          <Text
                            weight="bold"
                            style={{ color: "var(--color-text-mid)" }}
                          >
                            SQL
                          </Text>
                          {!readOnlyMode ? (
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
                                  form.watch("datasourceId") === ""
                                    ? "Select a Data Dource to run your query"
                                    : undefined
                                }
                              >
                                <Button
                                  size="xs"
                                  onClick={handleQuery}
                                  loading={isRunningQuery}
                                  icon={<FaPlay />}
                                >
                                  Run
                                </Button>
                              </Tooltip>
                            </Flex>
                          ) : null}
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
                        resizeDependency={!!form.watch("results")}
                      />
                    </AreaWithHeader>
                  </Panel>
                  {form.watch("results").sql && (
                    <>
                      <PanelResizeHandle />
                      <Panel minSize={10}>
                        <DisplayTestQueryResults
                          duration={form.watch("results").duration || 0}
                          results={form.watch("results").results || []}
                          sql={form.watch("results").sql || ""}
                          error={form.watch("results").error || ""}
                          allowDownload={!readOnlyMode}
                        />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>

              {showDataSourcesPanel && !readOnlyMode ? (
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
                          value={form.watch("datasourceId")}
                          onChange={(value) => {
                            setDirty(true);
                            form.setValue("datasourceId", value);
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
