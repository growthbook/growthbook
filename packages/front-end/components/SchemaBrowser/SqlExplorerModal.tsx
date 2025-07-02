import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FaPlay,
  FaExclamationTriangle,
  FaCheck,
  FaTimes,
} from "react-icons/fa";
import { PiCaretDoubleRight, PiPencilSimpleFill, PiX } from "react-icons/pi";
import {
  DataVizConfig,
  SavedQuery,
  QueryExecutionResult,
} from "back-end/src/validators/saved-queries";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { isReadOnlySQL } from "shared/sql";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
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
import useOrgSettings from "@/hooks/useOrgSettings";
import { VisualizationAddIcon } from "@/components/Icons";
import { SqlExplorerDataVisualization } from "../DataViz/SqlExplorerDataVisualization";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import Tooltip from "../Tooltip/Tooltip";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export interface Props {
  close: () => void;
  initial?: {
    sql?: string;
    name?: string;
    datasourceId?: string;
    results?: QueryExecutionResult;
    dateLastRan?: Date | string;
    dataVizConfig?: DataVizConfig[];
  };
  id?: string;
  mutate: () => void;
  disableSave?: boolean; // Controls if user can save query AND also controls if they can create/save visualizations
  header?: string;
  lockDatasource?: boolean; // Prevents changing data source. Useful if an org opens this from a data source id page, or when editing an experiment query that requires a certain data source
  trackingEventModalSource?: string;
}

export default function SqlExplorerModal({
  close,
  initial,
  id,
  mutate,
  disableSave = false,
  header,
  lockDatasource = false,
  trackingEventModalSource = "",
}: Props) {
  const [showSidePanel, setSidePanel] = useState(true);
  const [dirty, setDirty] = useState(id ? false : true);
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tab, setTab] = useState(
    initial?.dataVizConfig?.length && !disableSave ? "visualization-0" : "sql"
  );

  const { getDatasourceById, datasources } = useDefinitions();
  const { defaultDataSource } = useOrgSettings();

  const initialDatasourceId =
    initial?.datasourceId || defaultDataSource || datasources[0]?.id;

  const form = useForm<
    Omit<SavedQuery, "dateCreated" | "dateUpdated" | "dataVizConfig"> & {
      dataVizConfig?: Partial<DataVizConfig>[];
    }
  >({
    defaultValues: {
      name: initial?.name || "",
      sql: initial?.sql || "",
      dateLastRan: initial?.dateLastRan
        ? getValidDate(initial?.dateLastRan)
        : undefined,
      dataVizConfig: initial?.dataVizConfig || [],
      datasourceId: initialDatasourceId || "",
      results: initial?.results || {
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
      if (!isReadOnlySQL(sql)) {
        throw new Error("Only SELECT queries are allowed.");
      }

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

    // If we have an empty object for dataVizConfig, set it to an empty array
    const dataVizConfig = form.watch("dataVizConfig") || [];
    // Validate each dataVizConfig object
    dataVizConfig.forEach((config, index) => {
      if (!config.xAxis) {
        setTab(`visualization-${index}`);
        throw new Error(
          `X axis is required for Visualization ${
            config.title ? config.title : `${index + 1}`
          }. Please add an X axis or remove the visualization to save the query.`
        );
      }
      if (!config.yAxis) {
        setTab(`visualization-${index}`);
        throw new Error(
          `Y axis is required for Visualization ${
            config.title ? config.title : `${index + 1}`
          }. Please add a y axis or remove the visualization to save the query.`
        );
      }
    });

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
            dataVizConfig,
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
          dataVizConfig: dataVizConfig,
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
    // Reset the results field so it's empty
    form.setValue("results", {
      results: [],
      error: undefined,
      duration: undefined,
      sql: undefined,
    });
    try {
      const { results, error, duration, sql } = await runQuery(
        form.watch("sql")
      );
      // Update the form's results field
      form.setValue("results", {
        results: results || [],
        error,
        duration,
        sql,
      });
    } catch (e) {
      form.setValue("results", {
        results: [],
        error: e.message,
        duration: undefined,
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
  // Also only show datasources that the user has permission to query
  const validDatasources = datasources.filter(
    (d) =>
      d.type !== "google_analytics" &&
      permissionsUtil.canRunSqlExplorerQueries(d)
  );

  const dataVizConfig = form.watch("dataVizConfig") || [];

  return (
    <Modal
      bodyClassName="p-0"
      borderlessHeader={true}
      close={close}
      loading={loading}
      closeCta="Close"
      cta="Save & Close"
      ctaEnabled={canSave}
      hideCta={disableSave}
      disabledMessage={
        !hasCommercialFeature("saveSqlExplorerQueries")
          ? "Upgrade to a Pro or Enterprise plan to save your queries."
          : !hasPermission
          ? "You don't have permission to save this query."
          : undefined
      }
      header={header || `${id ? "Update" : "Create"} SQL Query`}
      headerClassName={styles["modal-header-backgroundless"]}
      open={true}
      showHeaderCloseButton={true}
      size="max"
      autoCloseOnSubmit={false}
      submit={async () => await handleSubmit()}
      trackingEventModalType="sql-explorer"
      trackingEventModalSource={trackingEventModalSource}
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
          value={tab}
          onValueChange={(newTab) => {
            // If old tab is sql and switching to visualization, show the side panel
            if (tab === "sql") {
              setSidePanel(true);
            }
            setTab(newTab);
          }}
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          {!disableSave ? (
            <Flex
              align="center"
              mb="4"
              gap="3"
              style={{ borderBottom: "1px solid var(--gray-a6)" }}
            >
              <TabsList>
                <TabsTrigger value="sql">
                  <Flex align="center" gap="2">
                    {isEditingName ? (
                      <Flex align="center" gap="2">
                        <input
                          type="text"
                          className="form-control"
                          value={tempName}
                          placeholder="Enter a name..."
                          onChange={(e) => setTempName(e.target.value)}
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
                {dataVizConfig.map((config, index) => (
                  <TabsTrigger value={`visualization-${index}`} key={index}>
                    <Flex align="center" gap="2">
                      {config.title || `Visualization ${index + 1}`}
                      {!readOnlyMode && tab === `visualization-${index}` ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setDirty(true);
                            const currentConfig = [...dataVizConfig];
                            currentConfig.splice(index, 1);
                            form.setValue("dataVizConfig", currentConfig);
                            setTab(
                              index < dataVizConfig.length - 1
                                ? `visualization-${index}`
                                : index > 0
                                ? `visualization-${index - 1}`
                                : "sql"
                            );
                          }}
                          title="Delete Visualization"
                        >
                          <PiX />
                        </Button>
                      ) : null}
                    </Flex>
                  </TabsTrigger>
                ))}
              </TabsList>
              {!readOnlyMode && dataVizConfig.length < 3 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDirty(true);
                    const currentConfig = [...dataVizConfig];
                    form.setValue("dataVizConfig", [
                      ...currentConfig,
                      { chartType: "bar" },
                    ]);
                    setTab(`visualization-${currentConfig.length}`);
                    setSidePanel(true);
                  }}
                  title="Add Visualization"
                  disabled={
                    !form.watch("results").results ||
                    form.watch("results").results.length === 0
                  }
                >
                  <VisualizationAddIcon />{" "}
                  {!dataVizConfig.length ? (
                    <span className="ml-1">Add Visualization</span>
                  ) : (
                    ""
                  )}
                </Button>
              ) : null}
              <div className="ml-auto" />
              {!readOnlyMode ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setSidePanel(!showSidePanel)}
                >
                  <PiCaretDoubleRight
                    style={{
                      transform: showSidePanel
                        ? "rotate(0deg)"
                        : "rotate(180deg)",
                      transition: "transform 0.5s ease",
                    }}
                  />
                </Button>
              ) : null}
            </Flex>
          ) : null}
          <TabsContent value="sql" style={{ flex: 1, overflow: "hidden" }}>
            <PanelGroup direction="horizontal">
              <Panel id="main" order={1} defaultSize={showSidePanel ? 70 : 100}>
                <PanelGroup direction="vertical">
                  <Panel
                    id="sql-editor"
                    order={1}
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
                                <Tooltip body={formatError}>
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
                                body="Select a Data Source to run your query"
                                shouldDisplay={!form.watch("datasourceId")}
                              >
                                <Button
                                  size="xs"
                                  onClick={handleQuery}
                                  disabled={
                                    !form.watch("sql") ||
                                    !form.watch("datasourceId")
                                  }
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
                        helpText={""}
                        fullHeight
                        setCursorData={setCursorData}
                        onCtrlEnter={handleQuery}
                        disabled={readOnlyMode}
                      />
                    </AreaWithHeader>
                  </Panel>
                  {form.watch("results").sql && (
                    <>
                      <PanelResizeHandle />
                      <Panel
                        id="query-results"
                        order={2}
                        defaultSize={form.watch("results").results ? 70 : 0}
                        minSize={10}
                      >
                        <DisplayTestQueryResults
                          duration={form.watch("results").duration || 0}
                          results={form.watch("results").results || []}
                          sql={form.watch("results").sql || ""}
                          error={form.watch("results").error || ""}
                          allowDownload={true}
                          showSampleHeader={false}
                        />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </Panel>

              {showSidePanel && !readOnlyMode ? (
                <>
                  <PanelResizeHandle />
                  <Panel
                    id="sidebar"
                    order={2}
                    defaultSize={30}
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
                        <Tooltip
                          body="You cannot change the Data Source from this view."
                          shouldDisplay={lockDatasource}
                        >
                          <SelectField
                            className="mb-2"
                            disabled={lockDatasource}
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
                        </Tooltip>
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

          {dataVizConfig.map((config, index) => (
            <TabsContent
              key={index}
              value={`visualization-${index}`}
              style={{ flex: 1, overflow: "hidden" }}
            >
              {!form.watch("results").results ||
              form.watch("results").results.length === 0 ? (
                <Flex justify="center" align="center" height="100%">
                  <Text align="center">
                    No results to visualize.
                    <br />
                    Ensure your query has results to add a visualization.
                  </Text>
                </Flex>
              ) : (
                <SqlExplorerDataVisualization
                  rows={form.watch("results").results}
                  dataVizConfig={config}
                  onDataVizConfigChange={(updatedConfig) => {
                    const newDataVizConfig = [...dataVizConfig];
                    newDataVizConfig[index] = updatedConfig;
                    setDirty(true);
                    form.setValue("dataVizConfig", newDataVizConfig);
                  }}
                  showPanel={showSidePanel && !readOnlyMode}
                />
              )}
            </TabsContent>
          ))}
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
      <Box flexGrow="1" style={{ overflowY: "auto" }}>
        {children}
      </Box>
    </Flex>
  );
}
