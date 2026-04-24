import React, { useEffect, useRef, useState } from "react";
import { Flex, Box, AlertDialog } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiDotsSix } from "react-icons/pi";
import { DatasetType, ExplorationConfig } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { useQueryState } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/next/pages";
import ShadowedScrollArea from "@/components/ShadowedScrollArea/ShadowedScrollArea";
import Button from "@/ui/Button";
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
} from "./util";

const EXPLORER_TYPE_LABELS: Record<DatasetType, string> = {
  metric: "Metric",
  fact_table: "Fact Table",
  data_source: "Data Source",
};

const explorationQueryParser = explorationConfigParser.withOptions({
  shallow: true,
  throttleMs: 300,
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

function ExplorerContent() {
  return (
    <Flex direction="column" gap="3" height="calc(100vh - 72px)">
      <PanelGroup direction="horizontal">
        {/* Main Section */}
        <Panel
          id="main-section"
          order={1}
          defaultSize={75}
          minSize={65}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <ExplorerMainSection />
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
          <ShadowedScrollArea height="calc(100vh - 160px)">
            <ExplorerSideBar />
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
    setUrlConfig(draftExploreState);
  }, [draftExploreState, setUrlConfig]);

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
  const defaultDataSourceId = useDefaultDataSourceId();

  const [urlConfig, setUrlConfig] = useQueryState(
    "config",
    explorationQueryParser,
  );

  const rawParam =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("config") ?? undefined)
      : undefined;

  const configError = deriveConfigError(urlConfig, rawParam, type);

  const [configErrorModal, setConfigErrorModal] = useState<string | null>(
    () => configError,
  );

  const defaultDataset = createEmptyDataset(type);
  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type,
    datasource: defaultDataSourceId,
    dataset: { ...defaultDataset, values: [createEmptyValue(type)] },
  } as ExplorationConfig;

  const initialConfig =
    urlConfig && !configError ? urlConfig : defaultDraftState;

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
      <ExplorerProvider key={type} initialConfig={initialConfig}>
        <ExplorerUrlSync setUrlConfig={setUrlConfig} />
        <ExplorerContent />
      </ExplorerProvider>
    </>
  );
}
