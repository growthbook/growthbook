import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { Flex, Box, AlertDialog } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiDotsSix } from "react-icons/pi";
import {
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
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerSideBar from "./SideBar/ExplorerSideBar";
import {
  ExplorerProvider,
  useExplorerContext,
  useDefaultDataSourceId,
} from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";
import {
  createEmptyDataset,
  createEmptyValue,
  decodeExplorationConfig,
  explorationConfigParser,
  ExplorerDraftConfig,
  previousTimeFrameQueryParser,
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
  hideDataSourceSelector = false,
  sidebarHeaderActions,
}: {
  hideDataSourceSelector?: boolean;
  sidebarHeaderActions?: React.ReactNode;
}) {
  const { managedWarehouseUnavailable } = useExplorerContext();

  return (
    <Flex direction="column" gap="3" height="calc(100vh - 72px)">
      {managedWarehouseUnavailable ? (
        <Box px="2">
          <ManagedWarehouseNoEventsCallout />
        </Box>
      ) : null}
      <PanelGroup direction="horizontal">
        {/* Main Section */}
        <Panel
          id="main-section"
          order={1}
          defaultSize={75}
          minSize={65}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <ExplorerMainSection
            showDataSourceSelector={!hideDataSourceSelector}
          />
        </Panel>

        {/* Resize Handle */}
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
            mt="9"
            style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
          ></Box>
          <PiDotsSix size={16} style={{ transform: "rotate(90deg)" }} />
          <Box
            flexGrow="1"
            my="3"
            style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
          ></Box>
        </PanelResizeHandle>

        {/* Sidebar */}
        <Panel id="sidebar" order={2} defaultSize={25} minSize={20}>
          {/* Let the scroll area fill the panel (which already sizes itself
              against the parent group's height) instead of a hardcoded
              `calc(100vh - 160px)` — the latter left ~88px dead space at
              the bottom and caused unnecessary scrolling. */}
          <ShadowedScrollArea height="100%">
            <ExplorerSideBar headerActions={sidebarHeaderActions} />
          </ShadowedScrollArea>
        </Panel>
      </PanelGroup>
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
}: {
  setUrlPreviousTimeFrame: (value: ExplorationDateRange | null) => void;
}) {
  const { draftExploreState } = useExplorerContext();
  const hasUserModified = useRef(false);

  useEffect(() => {
    if (!hasUserModified.current) {
      hasUserModified.current = true;
      return;
    }
    void setUrlPreviousTimeFrame(draftExploreState.previousTimeFrame ?? null);
  }, [draftExploreState.previousTimeFrame, setUrlPreviousTimeFrame]);

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
  const { ready, getFactMetricById, getFactTableById, getDatasourceById } =
    useDefinitions();

  const [urlConfig, setUrlConfig] = useQueryState(
    "config",
    explorationQueryParser,
  );

  const [urlPreviousTimeFrame, setUrlPreviousTimeFrame] = useQueryState(
    "previousTimeFrame",
    previousTimeFrameParser,
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

  // Funnels manage their initial state via createEmptyDataset (which seeds
  // one empty step); the other dataset types still seed an empty value here
  // so the sidebar opens with one ready-to-edit row.
  const defaultDataset = createEmptyDataset(type);
  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type,
    datasource: defaultDataSourceId,
    dataset:
      type === "funnel"
        ? defaultDataset
        : { ...defaultDataset, values: [createEmptyValue(type)] },
    // Funnels don't render time-series charts, so the default date dimension
    // from DEFAULT_EXPLORE_STATE doesn't apply — start with no dimensions and
    // let the user add one explicitly via "Group By".
    ...(type === "funnel" ? { dimensions: [] } : {}),
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
      ? { previousTimeFrame: urlPreviousTimeFrame }
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
        <ExplorerUrlSync setUrlConfig={setUrlConfig} />
        <ExplorerPreviousTimeFrameUrlSync
          setUrlPreviousTimeFrame={setUrlPreviousTimeFrame}
        />
        <ExplorerContent />
      </ExplorerProvider>
    </>
  );
}
