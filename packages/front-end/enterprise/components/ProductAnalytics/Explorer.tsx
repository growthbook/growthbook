import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Flex, Box, AlertDialog } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiDotsSix } from "react-icons/pi";
import {
  ComparisonMode,
  DatasetType,
  ExplorationConfig,
  ExplorationDateRange,
} from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { useQueryState } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/next/pages";
import ShadowedScrollArea from "@/components/ShadowedScrollArea/ShadowedScrollArea";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Tooltip from "@/components/Tooltip/Tooltip";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import EmptyState from "./EmptyState";
import ExplorerSideBar from "./SideBar/ExplorerSideBar";
import {
  ExplorerProvider,
  useExplorerContext,
  useDefaultDataSourceId,
} from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";
import DataSourceDropdown from "./MainSection/Toolbar/DataSourceDropdown";
import ExplorerPageActions from "./ExplorerPageActions";
import { useOptionalSqlEditorContext } from "./SqlEditorContext";
import {
  createEmptyDataset,
  createEmptyValue,
  decodeExplorationConfig,
  explorationConfigParser,
  ExplorerDraftConfig,
  previousTimeFrameQueryParser,
  comparisonModeQueryParser,
  stripExplorerDraftFields,
} from "./util";

const EXPLORER_TYPE_LABELS: Record<DatasetType, string> = {
  metric: "Metric",
  fact_table: "Fact Table",
  data_source: "Data Source",
  sql: "SQL",
  funnel: "Funnel",
};

const explorationQueryParser = explorationConfigParser.withOptions({
  shallow: true,
  throttleMs: 300,
});

const previousTimeFrameParser = previousTimeFrameQueryParser.withOptions({
  shallow: true,
  throttleMs: 0,
});

const comparisonModeParser = comparisonModeQueryParser.withOptions({
  shallow: true,
  throttleMs: 0,
});

function deriveConfigError(
  urlConfig: ExplorationConfig | null,
  rawParam: string | undefined,
  type: DatasetType,
): string | null {
  if (!rawParam) return null;

  if (!urlConfig) {
    const result = decodeExplorationConfig(rawParam);
    return result.error;
  }

  if (urlConfig.type !== type) {
    return `This link was created from the ${
      EXPLORER_TYPE_LABELS[urlConfig.type]
    } explorer, but you're currently viewing the ${
      EXPLORER_TYPE_LABELS[type]
    } explorer.`;
  }

  return null;
}

export function ExplorerContent({
  height = "calc(100vh - 72px)",
  hideDataSourceSelector = false,
  hideSidebarHeaderActions = false,
  sidebarHeaderActions,
}: {
  height?: string;
  hideDataSourceSelector?: boolean;
  hideSidebarHeaderActions?: boolean;
  sidebarHeaderActions?: React.ReactNode;
}) {
  const { managedWarehouseUnavailable, draftExploreState } =
    useExplorerContext();
  const sqlEditorContext = useOptionalSqlEditorContext();
  const isSql = draftExploreState.type === "sql";

  const explorerBody = (
    <PanelGroup direction="horizontal">
      <Panel
        id="main-section"
        order={1}
        defaultSize={75}
        minSize={65}
        style={{ display: "flex", flexDirection: "column" }}
      >
        <ExplorerMainSection
          showDataSourceSelector={!hideDataSourceSelector && !isSql}
        />
      </Panel>

      <PanelResizeHandle
        style={{
          width: "10px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box
          flexGrow="1"
          mb="3"
          mt={isSql ? "3" : "9"}
          style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
        ></Box>
        <PiDotsSix size={16} style={{ transform: "rotate(90deg)" }} />
        <Box
          flexGrow="1"
          my="3"
          style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
        ></Box>
      </PanelResizeHandle>

      <Panel id="sidebar" order={2} defaultSize={25} minSize={20}>
        <ShadowedScrollArea height="100%">
          <ExplorerSideBar
            hideHeaderActions={hideSidebarHeaderActions || isSql}
            headerActions={sidebarHeaderActions}
          />
        </ShadowedScrollArea>
      </Panel>
    </PanelGroup>
  );

  return (
    <Flex direction="column" gap="3" height={height}>
      {managedWarehouseUnavailable ? (
        <Box px="2">
          <ManagedWarehouseNoEventsCallout />
        </Box>
      ) : null}
      {isSql && sqlEditorContext ? (
        <>
          <Flex direction="column" gap="1" px="2" flexShrink="0">
            {!hideDataSourceSelector ? (
              <Flex align="center" height="32px" mt="1">
                <DataSourceDropdown />
              </Flex>
            ) : null}
          </Flex>
          <Tabs
            value={sqlEditorContext.viewMode}
            onValueChange={(value) => {
              if (value === "dataset" || value === "explore") {
                sqlEditorContext.setViewMode(value);
                if (value === "explore") {
                  sqlEditorContext.markExploreSeen();
                }
              }
            }}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Flex
              align="center"
              justify="between"
              flexShrink="0"
              px="2"
              style={{
                width: "100%",
                borderBottom: "1px solid var(--gray-a5)",
              }}
            >
              <TabsList
                style={{
                  boxShadow: "none",
                }}
                size="lg"
              >
                <TabsTrigger value="dataset">1. Build Dataset</TabsTrigger>
                <Tooltip
                  body="Write or generate a query to build your dataset. Then you can explore the results and build visualizations with the data."
                  shouldDisplay={!sqlEditorContext.exploreReady}
                >
                  <span style={{ display: "inline-flex" }}>
                    <TabsTrigger
                      value="explore"
                      disabled={!sqlEditorContext.exploreReady}
                    >
                      <Flex align="center" gap="2">
                        2. Explore Dataset
                        {sqlEditorContext.exploreReady &&
                        !sqlEditorContext.hasSeenExplore ? (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: "var(--green-9)",
                              flexShrink: 0,
                            }}
                            aria-label="Sample results ready"
                          />
                        ) : null}
                      </Flex>
                    </TabsTrigger>
                  </span>
                </Tooltip>
              </TabsList>
              <Flex align="center" gap="2">
                {!hideSidebarHeaderActions && !sidebarHeaderActions ? (
                  <ExplorerPageActions />
                ) : (
                  sidebarHeaderActions
                )}
              </Flex>
            </Flex>
            <Box style={{ flex: 1, minHeight: 0 }}>{explorerBody}</Box>
          </Tabs>
        </>
      ) : (
        explorerBody
      )}
    </Flex>
  );
}

function ExplorerUrlSync({
  setUrlConfig,
}: {
  setUrlConfig: (config: ExplorationConfig) => void;
}) {
  const { draftExploreState } = useExplorerContext();
  const hasUserModified = useRef(false);

  useEffect(() => {
    if (!hasUserModified.current) {
      hasUserModified.current = true;
      return;
    }
    setUrlConfig(stripExplorerDraftFields(draftExploreState));
  }, [draftExploreState, setUrlConfig]);

  return null;
}

function ExplorerPreviousTimeFrameUrlSync({
  setUrlPreviousTimeFrame,
  setUrlComparisonMode,
}: {
  setUrlPreviousTimeFrame: (value: ExplorationDateRange | null) => void;
  setUrlComparisonMode: (value: ComparisonMode | null) => void;
}) {
  const { draftExploreState, compareEnabled, comparisonMode } =
    useExplorerContext();
  const hasUserModified = useRef(false);

  useEffect(() => {
    if (!hasUserModified.current) {
      hasUserModified.current = true;
      return;
    }
    void setUrlPreviousTimeFrame(draftExploreState.previousTimeFrame ?? null);
    void setUrlComparisonMode(compareEnabled ? comparisonMode : null);
  }, [
    draftExploreState.previousTimeFrame,
    compareEnabled,
    comparisonMode,
    setUrlPreviousTimeFrame,
    setUrlComparisonMode,
  ]);

  return null;
}

export default function Explorer({ type }: { type: DatasetType }) {
  return (
    <NuqsAdapter>
      <ExplorerInner type={type} />
    </NuqsAdapter>
  );
}

function ExplorerInner({ type }: { type: DatasetType }) {
  const router = useRouter();
  const defaultDataSourceId = useDefaultDataSourceId();
  const {
    ready,
    datasources,
    getFactMetricById,
    getFactTableById,
    getDatasourceById,
  } = useDefinitions();

  const [urlConfig, setUrlConfig] = useQueryState(
    "config",
    explorationQueryParser,
  );

  const [urlPreviousTimeFrame, setUrlPreviousTimeFrame] = useQueryState(
    "previousTimeFrame",
    previousTimeFrameParser,
  );

  const [urlComparisonMode, setUrlComparisonMode] = useQueryState(
    "comparisonMode",
    comparisonModeParser,
  );

  const getQueryParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const rawParam = getQueryParam(router.query.config);
  const metricId = getQueryParam(router.query.metricId);
  const factTableId = getQueryParam(router.query.factTableId);
  const datasourceId = getQueryParam(router.query.datasourceId);
  const seedId =
    type === "metric"
      ? metricId
      : type === "fact_table"
        ? factTableId
        : datasourceId;

  const configError = deriveConfigError(urlConfig, rawParam, type);

  const [configErrorModal, setConfigErrorModal] = useState<string | null>(
    () => configError,
  );

  // Funnels seed their first step in createEmptyDataset. SQL starts without a
  // value so running raw SQL does not also trigger an exploration query.
  const defaultDataset = createEmptyDataset(type);
  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type,
    datasource: defaultDataSourceId,
    dataset:
      type === "funnel" || type === "sql"
        ? defaultDataset
        : { ...defaultDataset, values: [createEmptyValue(type)] },
    // Funnels don't render time-series charts, so the default date dimension
    // from DEFAULT_EXPLORE_STATE doesn't apply — start with no dimensions and
    // let the user add one explicitly via "Group By".
    // SQL starts as a table exploration with no dimensions until the user
    // configures them after testing their query.
    ...(type === "funnel" || type === "sql" ? { dimensions: [] } : {}),
    ...(type === "sql" ? { chartType: "table" as const } : {}),
  } as ExplorerDraftConfig;

  let seedError: string | null = null;
  let seededConfig: ExplorerDraftConfig | null = null;

  if (!rawParam) {
    if (type === "metric" && metricId) {
      const metric = getFactMetricById(metricId);
      if (metric) {
        seededConfig = {
          ...defaultDraftState,
          datasource: metric.datasource,
          dataset: {
            ...createEmptyDataset("metric"),
            values: [
              {
                ...createEmptyValue("metric"),
                metricId: metric.id,
                name: metric.name,
              },
            ],
          },
        } as ExplorerDraftConfig;
      } else if (ready) {
        seedError = "Could not find the requested Fact Metric.";
      }
    } else if (type === "fact_table" && factTableId) {
      const factTable = getFactTableById(factTableId);
      if (factTable) {
        seededConfig = {
          ...defaultDraftState,
          datasource: factTable.datasource,
          dataset: {
            ...createEmptyDataset("fact_table"),
            factTableId: factTable.id,
            values: [createEmptyValue("fact_table")],
          },
        } as ExplorerDraftConfig;
      } else if (ready) {
        seedError = "Could not find the requested Fact Table.";
      }
    } else if (type === "data_source" && datasourceId) {
      const datasource = getDatasourceById(datasourceId);
      if (datasource) {
        seededConfig = {
          ...defaultDraftState,
          datasource: datasource.id,
        };
      } else if (ready) {
        seedError = "Could not find the requested Data Source.";
      }
    }
  }

  const restorationError = configError ?? seedError;

  useEffect(() => {
    if (restorationError) {
      setConfigErrorModal(restorationError);
    }
  }, [restorationError]);

  if (!router.isReady || !ready) {
    return <LoadingOverlay />;
  }

  const baseConfig =
    urlConfig && !configError ? urlConfig : (seededConfig ?? defaultDraftState);
  const initialConfig: ExplorerDraftConfig = {
    ...baseConfig,
    ...(urlPreviousTimeFrame
      ? {
          previousTimeFrame: urlPreviousTimeFrame,
          // Links shared before named modes existed carry no mode; the context
          // falls back to the legacy reading of the primary range.
          ...(urlComparisonMode ? { comparisonMode: urlComparisonMode } : {}),
        }
      : {}),
  };

  return (
    <>
      {configErrorModal && (
        <AlertDialog.Root open>
          <AlertDialog.Content maxWidth="480px">
            <AlertDialog.Title>
              Unable to restore configuration
            </AlertDialog.Title>
            <AlertDialog.Description>
              {configErrorModal} The explorer has been loaded with default
              settings.
            </AlertDialog.Description>
            <Flex justify="end" mt="4">
              <Button color="violet" onClick={() => setConfigErrorModal(null)}>
                Dismiss
              </Button>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
      <ExplorerProvider
        key={`${type}:${seedId ?? ""}`}
        initialConfig={initialConfig}
        trackingSource="manual-explorer"
      >
        {datasources.length === 0 ? (
          <Flex direction="column" height="calc(100vh - 72px)">
            <EmptyState />
          </Flex>
        ) : (
          <>
            <ExplorerUrlSync setUrlConfig={setUrlConfig} />
            <ExplorerPreviousTimeFrameUrlSync
              setUrlPreviousTimeFrame={setUrlPreviousTimeFrame}
              setUrlComparisonMode={setUrlComparisonMode}
            />
            <ExplorerContent />
          </>
        )}
      </ExplorerProvider>
    </>
  );
}
