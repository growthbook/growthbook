import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FaPlay, FaExclamationTriangle } from "react-icons/fa";
import {
  PiCaretDoubleRight,
  PiCheck,
  PiFileSql,
  PiPencilSimpleFill,
  PiX,
} from "react-icons/pi";
import {
  DataVizConfig,
  SavedQuery,
  QueryExecutionResult,
} from "shared/validators";
import { computeAIUsageData } from "shared/ai";
import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import { getValidDate } from "shared/dates";
import { isReadOnlySQL, SQL_ROW_LIMIT } from "shared/sql";
import { BsThreeDotsVertical, BsStars } from "react-icons/bs";
import { InformationSchemaInterfaceWithPaths } from "shared/types/integrations";
import { FiChevronRight } from "react-icons/fi";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import CodeTextArea, { AceCompletion } from "@/components/Forms/CodeTextArea";
import { CursorData } from "@/components/Segments/SegmentForm";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/ui/Button";
import { SelectItem } from "@/ui/Select";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { formatSql, canFormatSql } from "@/services/sqlFormatter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "@/components/ResizablePanels";
import { AppFeatures } from "@/types/app-features";
import track from "@/services/track";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
import { VisualizationAddIcon } from "@/components/Icons";
import { requiresXAxes, requiresXAxis } from "@/services/dataVizTypeGuards";
import {
  getXAxisConfig,
  setXAxisConfig,
} from "@/services/dataVizConfigUtilities";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { getAutoCompletions } from "@/services/sqlAutoComplete";
import Field from "@/components/Forms/Field";
import OptInModal from "@/components/License/OptInModal";
import Badge from "@/ui/Badge";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { SqlExplorerDataVisualization } from "@/components/DataViz/SqlExplorerDataVisualization";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { filterOptions } from "@/components/DataViz/DataVizFilter";
import SchemaBrowser from "./SchemaBrowser";
import styles from "./EditSqlModal.module.scss";

export interface SqlExplorerModalInitial {
  sql?: string;
  name?: string;
  datasourceId?: string;
  results?: QueryExecutionResult;
  dateLastRan?: Date | string;
  dataVizConfig?: DataVizConfig[];
}

export interface Props {
  dashboardId?: string;
  close: () => void;
  initial?: SqlExplorerModalInitial;
  id?: string;
  mutate: () => void;
  disableSave?: boolean; // Controls if user can save query AND also controls if they can create/save visualizations
  header?: string;
  lockDatasource?: boolean; // Prevents changing data source. Useful if an org opens this from a data source id page, or when editing an experiment query that requires a certain data source
  trackingEventModalSource?: string;
  onSave?: (data: {
    savedQueryId: string | undefined;
    name: string | undefined;
    newVisualizationIds: string[];
    allVisualizationIds: string[];
  }) => Promise<void>;
  projects?: string[];
}

export default function SqlExplorerModal({
  dashboardId,
  close,
  initial,
  id,
  mutate,
  disableSave = false,
  header,
  lockDatasource = false,
  trackingEventModalSource = "",
  onSave,
  projects = [],
}: Props) {
  const [showSidePanel, setSidePanel] = useState(true);
  const [dirty, setDirty] = useState(id ? false : true);
  const [loading, setLoading] = useState(false);
  const [isRunningQuery, setIsRunningQuery] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tab, setTab] = useState(
    initial?.dataVizConfig?.length && !disableSave ? "visualization-0" : "sql",
  );
  const [isAutocompleteEnabled, setIsAutocompleteEnabled] = useLocalStorage(
    "sql-editor-autocomplete-enabled",
    true,
  );
  const [autoCompletions, setAutoCompletions] = useState<AceCompletion[]>([]);
  const [informationSchema, setInformationSchema] = useState<
    InformationSchemaInterfaceWithPaths | undefined
  >();
  const { getDatasourceById, datasources } = useDefinitions();
  const { defaultDataSource } = useOrgSettings();

  let filteredDatasources: DataSourceInterfaceWithParams[] = [];

  // If the dashboard has a projects list, only include datasources that are contain all of the projects in the list or are in 'All Projects'
  if (projects.length) {
    filteredDatasources = datasources.filter((d) => {
      if (!d.projects || !d.projects.length) {
        return true;
      }

      // Always include the existing datasource if it exists, this will prevent issues if the datasource or the dashboard's projects have changed since the query was created.
      if (initial?.datasourceId && d.id === initial?.datasourceId) {
        return true;
      }

      return projects.every((p) => d.projects?.includes(p));
    });
  } else {
    filteredDatasources = datasources;
  }

  let initialDatasourceId = filteredDatasources[0]?.id;
  if (
    initial?.datasourceId &&
    filteredDatasources.find((d) => d.id === initial?.datasourceId)
  ) {
    initialDatasourceId = initial.datasourceId;
  } else if (
    defaultDataSource &&
    filteredDatasources.find((d) => d.id === defaultDataSource)
  ) {
    initialDatasourceId = defaultDataSource;
  }

  const form = useForm<
    Omit<SavedQuery, "dateCreated" | "dateUpdated" | "dataVizConfig"> & {
      dataVizConfig?: Partial<DataVizConfig>[];
    }
  >({
    defaultValues: {
      name: initial?.name || "New Query",
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

  const datasourceId = form.watch("datasourceId");

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const [openAIBox, setOpenAIBox] = useState<boolean>(false);
  const [aiInput, setAiInput] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAgreementModal, setAiAgreementModal] = useState<boolean>(false);
  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestionRef = useRef<string | undefined>(undefined);
  const permissionsUtil = usePermissionsUtil();
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<boolean>(true);

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

  const hasResults =
    !!form.watch("results")?.sql && !form.watch("results")?.error;

  const canSave: boolean =
    hasPermission &&
    hasCommercialFeature("saveSqlExplorerQueries") &&
    (!dashboardId || hasResults) &&
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
          limit: SQL_ROW_LIMIT,
        }),
      });
      return res;
    },
    [apiCall, form],
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

    // If we have an empty object for dataVizConfig, set it to an empty array
    const dataVizConfig = form.watch("dataVizConfig") || [];

    // Normalize dataVizConfig to ensure pivot tables have xAxis as arrays
    // and other charts have xAxis as single objects (for API compatibility)
    const normalizedDataVizConfig = dataVizConfig.map((config) => {
      // If the chart type doesn't support displaySettings, remove the displaySettings property
      // Only line and scatter charts support displaySettings
      const chartType = config.chartType;
      if (
        chartType &&
        !["line", "scatter"].includes(chartType) &&
        "displaySettings" in config
      ) {
        const { displaySettings: _displaySettings, ...rest } = config;
        return rest as DataVizConfig;
      }
      if (!requiresXAxis(config) || !config.xAxis) {
        return config as DataVizConfig;
      }

      // Get xAxis as array (internal representation)
      const xAxisConfigs = getXAxisConfig(config);

      if (xAxisConfigs.length === 0) {
        return config as DataVizConfig;
      }

      // Use setXAxisConfig to ensure correct format for API (array for pivot, single for others)
      return setXAxisConfig(config, xAxisConfigs) as DataVizConfig;
    }) as DataVizConfig[];

    // Validate each dataVizConfig object
    normalizedDataVizConfig.forEach((config, index) => {
      // Check if chart type requires xAxis but doesn't have one
      if (requiresXAxis(config) && !config.xAxis) {
        setTab(`visualization-${index}`);
        throw new Error(
          `X axis is required for Visualization ${
            config.title ? config.title : `${index + 1}`
          }. Please add an X axis or remove the visualization to save the query.`,
        );
      }
      if (requiresXAxes(config) && !config.xAxes) {
        setTab(`visualization-${index}`);
        throw new Error(
          `Columns are required for Visualization ${
            config.title ? config.title : `${index + 1}`
          }. Please add a column or remove the visualization to save the query.`,
        );
      }
      if (!config.yAxis) {
        setTab(`visualization-${index}`);
        throw new Error(
          `Y axis is required for Visualization ${
            config.title ? config.title : `${index + 1}`
          }. Please add a y axis or remove the visualization to save the query.`,
        );
      }

      // Validate filters
      if (config.filters && config.filters.length > 0) {
        config.filters.forEach((filter, filterIndex) => {
          const vizTitle = config.title || `${index + 1}`;

          // Validate required filter fields
          if (!filter.column) {
            setTab(`visualization-${index}`);
            throw new Error(
              `Filter ${filterIndex + 1} in Visualization ${vizTitle} is missing a column selection.`,
            );
          }

          if (!filter.columnType) {
            setTab(`visualization-${index}`);
            throw new Error(
              `Filter ${filterIndex + 1} in Visualization ${vizTitle} is missing a type selection.`,
            );
          }

          if (!filter.filterMethod) {
            setTab(`visualization-${index}`);
            throw new Error(
              `Filter ${filterIndex + 1} in Visualization ${vizTitle} is missing a filter type selection.`,
            );
          }

          // // Validate filter type matches the data type
          const filterOptionIndex = filterOptions.findIndex(
            (option) => option.value === filter.filterMethod,
          );

          if (filterOptionIndex === -1) {
            setTab(`visualization-${index}`);
            throw new Error(
              `Filter ${filterIndex + 1} in Visualization ${vizTitle} has an invalid filter type "${filter.filterMethod}" for data type "${filter.columnType}".`,
            );
          }

          const validFilterTypes =
            filterOptions[filterOptionIndex].supportedTypes;

          if (!validFilterTypes.includes(filter.columnType)) {
            setTab(`visualization-${index}`);
            throw new Error(
              `Filter ${filterIndex + 1} in Visualization ${vizTitle} has an invalid filter type "${filter.filterMethod}" for data type "${filter.columnType}".`,
            );
          }

          // Validate required config values based on filter type using discriminated union
          switch (filter.filterMethod) {
            case "dateRange":
              if (!filter.config.startDate && !filter.config.endDate) {
                setTab(`visualization-${index}`);
                throw new Error(
                  `Date range filter ${filterIndex + 1} in Visualization ${vizTitle} requires at least a start date or end date.`,
                );
              }
              break;

            case "numberRange":
              if (
                filter.config.min === undefined &&
                filter.config.max === undefined
              ) {
                setTab(`visualization-${index}`);
                throw new Error(
                  `Number range filter ${filterIndex + 1} in Visualization ${vizTitle} requires at least a minimum or maximum value.`,
                );
              }
              break;

            case "greaterThan":
            case "lessThan":
            case "equalTo":
              if (
                filter.config.value === undefined ||
                filter.config.value === ""
              ) {
                setTab(`visualization-${index}`);
                throw new Error(
                  `Filter ${filterIndex + 1} in Visualization ${vizTitle} requires a value.`,
                );
              }
              break;

            case "contains":
              if (
                !filter.config.value ||
                String(filter.config.value).trim() === ""
              ) {
                setTab(`visualization-${index}`);
                throw new Error(
                  `Text search filter ${filterIndex + 1} in Visualization ${vizTitle} requires search text.`,
                );
              }
              break;

            case "includes":
              if (
                !Array.isArray(filter.config.values) ||
                filter.config.values.length === 0
              ) {
                setTab(`visualization-${index}`);
                throw new Error(
                  `Multi-select filter ${filterIndex + 1} in Visualization ${vizTitle} requires at least one selected value.`,
                );
              }
              break;
          }
        });
      }
    });

    // If it's a new query (no savedQuery.id), always save
    if (!id) {
      try {
        const res = await apiCall<{
          savedQuery: SavedQuery;
          status: number;
        }>("/saved-queries", {
          method: "POST",
          body: JSON.stringify({
            name: currentName,
            sql: form.watch("sql"),
            datasourceId: form.watch("datasourceId"),
            dateLastRan: form.watch("dateLastRan"),
            results: form.watch("results"),
            dataVizConfig: normalizedDataVizConfig,
            linkedDashboardIds:
              dashboardId && dashboardId !== "new" ? [dashboardId] : [],
          }),
        });
        mutate();
        if (onSave) {
          const visualizationIds =
            res?.savedQuery?.dataVizConfig
              ?.map((viz) => viz.id)
              .filter((id): id is string => !!id) || [];
          await onSave({
            savedQueryId: res?.savedQuery?.id,
            name: currentName,
            newVisualizationIds: visualizationIds,
            allVisualizationIds: visualizationIds,
          });
        }
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
      const results = form.watch("results");
      const { savedQuery: updatedSavedQuery } = await apiCall<{
        status: number;
        savedQuery: SavedQuery;
      }>(`/saved-queries/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: currentName,
          sql: form.watch("sql"),
          datasourceId: form.watch("datasourceId"),
          dateLastRan: form.watch("dateLastRan"),
          dataVizConfig: normalizedDataVizConfig,
          results: {
            ...results,
            error: results.error || undefined, // Convert null/empty to undefined
          },
        }),
      });
      mutate();
      // Calculate existing and new visualization IDs
      // Existing IDs come from the initial dataVizConfig (what was there before)
      const existingVizIds =
        initial?.dataVizConfig
          ?.map((viz) => viz.id)
          .filter((id): id is string => !!id) || [];
      // Current IDs come from the response (all visualization IDs that exist now)
      const allCurrentVizIds =
        updatedSavedQuery?.dataVizConfig
          ?.map((viz) => viz.id)
          .filter((id): id is string => !!id) || [];
      // Find which IDs are newly added (in current but not in existing)
      const newlyAddedVizIds = allCurrentVizIds.filter(
        (id) => !existingVizIds.includes(id),
      );
      if (onSave) {
        await onSave({
          savedQueryId: id,
          name: currentName,
          newVisualizationIds: newlyAddedVizIds,
          allVisualizationIds: allCurrentVizIds,
        });
      }
      if (aiSuggestionRef.current) {
        track("SQL Query Saved", {
          aiUsageData: computeAIUsageData({
            value: form.watch("sql"),
            aiSuggestionText: aiSuggestionRef.current,
          }),
        });
      }
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
        form.watch("sql"),
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

    if (aiSuggestionRef.current) {
      track("SQL Query Run", {
        aiUsageData: computeAIUsageData({
          value: form.watch("sql"),
          aiSuggestionText: aiSuggestionRef.current,
        }),
      });
    }
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
  const generateSQL = async () => {
    if (!aiAgreedTo) {
      setAiAgreementModal(true);
      // This needs a timeout to avoid a flicker if this modal disappears before the AI agreement modal appears.
      setTimeout(() => {
        setShowModal(false);
      }, 0);
    } else {
      if (aiEnabled) {
        const aiTemperature =
          gb?.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1;
        track("ai-suggestion", { source: "sql-explorer", type: "suggest" });
        setAiError(null);
        setLoading(true);
        apiCall(
          `/saved-queries/generateSQL`,
          {
            method: "POST",
            body: JSON.stringify({
              input: aiInput,
              datasourceId: form.watch("datasourceId"),
              temperature: aiTemperature,
            }),
          },
          (responseData) => {
            if (responseData.status === 429) {
              const retryAfter = parseInt(responseData.retryAfter);
              const hours = Math.floor(retryAfter / 3600);
              const minutes = Math.floor((retryAfter % 3600) / 60);
              setAiError(
                `You have reached the AI request limit. Try again in ${hours} hours and ${minutes} minutes.`,
              );
            } else if (responseData.message) {
              setAiError(
                "Error getting AI suggestion: " + responseData.message,
              );
              throw new Error(responseData.message);
            } else {
              setAiError("Error getting AI suggestion");
            }
            setLoading(false);
          },
        )
          .then((res: { data: { sql: string; errors: string[] } }) => {
            form.setValue("sql", res.data.sql);
            aiSuggestionRef.current = res.data.sql;
            if (res.data.errors && res.data.errors.length > 0) {
              setAiError(res.data.errors.join(", "));
            }
            setDirty(true);
          })
          .catch(() => {
            // Error handling is done by the apiCall errorHandler
          })
          .finally(() => {
            setLoading(false);
          });
      } else {
        setAiError("AI is disabled for your organization. Adjust in settings.");
      }
    }
  };
  const handleAIClick = () => {
    if (!hasAISuggestions) {
      throw new Error(
        "AI suggestions are not enabled for your organization. Please contact your administrator.",
      );
    }
    if (!aiAgreedTo) {
      setAiAgreementModal(true);
      // This needs a timeout to avoid a flicker if this modal disappears before the AI agreement modal appears.
      setTimeout(() => {
        setShowModal(false);
      }, 0);
    }
    if (!aiEnabled) {
      throw new Error(
        "AI suggestions are disabled for your organization. Please contact your administrator.",
      );
    }
    setOpenAIBox(!openAIBox);
  };

  const getTruncatedTitle = (
    title: string,
    totalVisualizationCount: number,
  ): string => {
    // Only truncate if there are 4 or more visualizations
    if (totalVisualizationCount < 4) return title;

    const maxLength = 20;
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + "...";
  };

  // Filter datasources to only those that support SQL queries
  // Also only show datasources that the user has permission to query
  const validDatasources = filteredDatasources.filter(
    (d) =>
      d.type !== "google_analytics" &&
      permissionsUtil.canRunSqlExplorerQueries(d),
  );

  const dataVizConfig = form.watch("dataVizConfig") || [];

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
          "SqlExplorer",
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

  return (
    <>
      <Modal
        bodyClassName="p-0"
        borderlessHeader={true}
        backgroundlessHeader={true}
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
              : dashboardId && !hasResults
                ? "Run the query first before saving."
                : undefined
        }
        header={header || `${id ? "Update" : "Create"} SQL Query`}
        open={showModal}
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
                style={{
                  borderBottom: "1px solid var(--gray-a6)",
                }}
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
                            style={{
                              border: "none",
                              outline: "none",
                            }}
                          />
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              setDirty(true);
                              form.setValue("name", tempName);
                              setIsEditingName(false);
                            }}
                          >
                            <PiCheck />
                          </Button>
                          <Button
                            color="red"
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              setTempName(form.watch("name"));
                              setIsEditingName(false);
                            }}
                          >
                            <PiX />
                          </Button>
                        </Flex>
                      ) : (
                        <>
                          <PiFileSql size={20} />
                          {form.watch("name") || "Untitled Query..."}
                          {!readOnlyMode && tab === "sql" ? (
                            <Box
                              px="2"
                              title="Edit Name"
                              onClick={() => {
                                setTempName(form.watch("name"));
                                setIsEditingName(true);
                              }}
                            >
                              <PiPencilSimpleFill color="var(--accent-11)" />
                            </Box>
                          ) : null}
                        </>
                      )}
                    </Flex>
                  </TabsTrigger>
                  {dataVizConfig.map((config, index) => (
                    <TabsTrigger
                      value={`visualization-${index}`}
                      key={index}
                      style={{ paddingRight: "0px" }}
                    >
                      <Flex align="center" gap="2">
                        <span
                          title={config.title || `Visualization ${index + 1}`}
                        >
                          {getTruncatedTitle(
                            config.title || `Visualization ${index + 1}`,
                            dataVizConfig.length,
                          )}
                        </span>
                        {!readOnlyMode && tab === `visualization-${index}` ? (
                          <DropdownMenu
                            trigger={
                              <button className="btn btn-link pr-0">
                                <BsThreeDotsVertical color="var(--text-color-main" />
                              </button>
                            }
                          >
                            <Tooltip
                              body="You can only add up to 10 visualizations to a query."
                              shouldDisplay={dataVizConfig.length >= 10}
                            >
                              <DropdownMenuItem
                                onClick={() => {
                                  setDirty(true);
                                  const newDataVizConfig = [
                                    ...dataVizConfig,
                                    {
                                      ...config,
                                      id: undefined, // Generate a new ID once the request hits the backend
                                      title: `${
                                        config.title ||
                                        `Visualization ${index + 1}`
                                      } (Copy)`,
                                    },
                                  ];
                                  form.setValue(
                                    "dataVizConfig",
                                    newDataVizConfig,
                                  );
                                  setTab(
                                    `visualization-${dataVizConfig.length}`,
                                  );
                                }}
                                disabled={dataVizConfig.length >= 10}
                              >
                                Duplicate
                              </DropdownMenuItem>
                            </Tooltip>
                            <DropdownMenuItem
                              color="red"
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
                                      : "sql",
                                );
                              }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenu>
                        ) : null}
                      </Flex>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {!readOnlyMode ? (
                  <Tooltip
                    shouldDisplay={dataVizConfig.length >= 10}
                    body="You can only add up to 10 visualizations to a query."
                  >
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
                      title={
                        dataVizConfig.length >= 10 ? "" : "Add Visualization"
                      }
                      disabled={
                        !form.watch("results").results ||
                        form.watch("results").results.length === 0 ||
                        dataVizConfig.length >= 10
                      }
                    >
                      <VisualizationAddIcon />{" "}
                      {!dataVizConfig.length ? (
                        <span className="ml-1">Add Visualization</span>
                      ) : (
                        ""
                      )}
                    </Button>
                  </Tooltip>
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
                <Panel
                  id="main"
                  order={1}
                  defaultSize={showSidePanel ? 70 : 100}
                >
                  <PanelGroup direction="vertical">
                    <Panel
                      id="sql-editor"
                      order={1}
                      defaultSize={
                        form.watch("results").sql ? (openAIBox ? 50 : 30) : 100
                      }
                      minSize={7}
                    >
                      <AreaWithHeader
                        header={
                          <Flex align="center" justify="between">
                            <Flex gap="4" align="center">
                              <Box>
                                <Text
                                  weight="bold"
                                  style={{ color: "var(--color-text-mid)" }}
                                >
                                  SQL
                                </Text>
                              </Box>
                              {!readOnlyMode && (
                                <Tooltip
                                  body={
                                    aiEnabled ? (
                                      ""
                                    ) : (
                                      <>
                                        Org admins can enable AI powered SQL
                                        generation in{" "}
                                        <strong>General Settings</strong>.
                                      </>
                                    )
                                  }
                                >
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={handleAIClick}
                                  >
                                    <BsStars /> Text to SQL{" "}
                                    <Badge
                                      label="BETA"
                                      color="amber"
                                      variant="solid"
                                      style={{
                                        margin: "0 4px",
                                        paddingTop: "1px",
                                        backgroundColor: "var(--slate-12)",
                                        color: "var(--gray-1)",
                                      }}
                                    />
                                    <FiChevronRight
                                      style={{
                                        transform: openAIBox
                                          ? "rotate(90deg)"
                                          : "none",
                                      }}
                                    />
                                  </Button>
                                </Tooltip>
                              )}
                            </Flex>
                            {!readOnlyMode ? (
                              <Flex gap="3" align="center">
                                <Tooltip body="The SQL Explorer automatically applies a 1000 row limit to ensure optimal performance.">
                                  <Box pl="5">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      id={`limit-toggle`}
                                      checked={true}
                                      disabled={true}
                                    />
                                    <Text
                                      size="1"
                                      weight="medium"
                                      style={{ color: "var(--gray-8)" }}
                                      className="cursor-pointer"
                                    >
                                      Limit to {SQL_ROW_LIMIT} rows
                                    </Text>
                                  </Box>
                                </Tooltip>
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
                                      setIsAutocompleteEnabled(
                                        !isAutocompleteEnabled,
                                      );
                                    }}
                                  >
                                    {isAutocompleteEnabled
                                      ? "Disable Autocomplete"
                                      : "Enable Autocomplete"}
                                  </DropdownMenuItem>
                                </DropdownMenu>
                              </Flex>
                            ) : null}
                          </Flex>
                        }
                      >
                        {openAIBox && (
                          <Flex>
                            <Box width="100%" px="4" py="3" pb="4">
                              <Box pb="3">
                                <label>
                                  Natural language to SQL{" "}
                                  <Tooltip body="Use text to describe what you would like to generate. The AI is aware of your table structure, but may still hallucinate, particularly with dates." />
                                </label>
                                <Field
                                  textarea={true}
                                  value={aiInput}
                                  placeholder="Make a request, e.g. 'Show me the top 10 users by revenue in the last month.'"
                                  onChange={(e) => {
                                    setAiInput(e.target.value);
                                  }}
                                />
                              </Box>
                              <Flex align="center" justify="start" gap="4">
                                <Button
                                  onClick={generateSQL}
                                  disabled={loading || !aiInput}
                                >
                                  <BsStars />{" "}
                                  {loading ? "Generating..." : "Generate SQL"}
                                </Button>
                                <Box className="text-muted"></Box>
                              </Flex>
                              {aiError && (
                                <Box
                                  className="text-danger"
                                  style={{ padding: "8px" }}
                                >
                                  {aiError}
                                </Box>
                              )}
                            </Box>
                          </Flex>
                        )}
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
                          completions={autoCompletions}
                        />
                      </AreaWithHeader>
                    </Panel>
                    {form.watch("results").sql && (
                      <>
                        <PanelResizeHandle />
                        <Panel
                          id="query-results"
                          order={2}
                          defaultSize={
                            form.watch("results").results
                              ? openAIBox
                                ? 50
                                : 70
                              : 0
                          }
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
      {aiAgreementModal && (
        <OptInModal
          agreement="ai"
          onClose={() => {
            setShowModal(true);
            setAiAgreementModal(false);
          }}
        />
      )}
    </>
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
