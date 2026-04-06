import React, { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerAIChat from "@/enterprise/components/ProductAnalytics/ExplorerAIChat";
import {
  ExplorerProvider,
  LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyDataset,
  createEmptyValue,
} from "@/enterprise/components/ProductAnalytics/util";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export default function AIChatExplorePage() {
  const { datasources } = useDefinitions();
  const defaultDataset = createEmptyDataset("metric");

  const [defaultDataSourceId] = useLocalStorage<string | undefined>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    datasources[0]?.id ?? "",
  );

  const resolvedDataSourceId = useMemo(() => {
    return datasources.some((d) => d.id === defaultDataSourceId)
      ? defaultDataSourceId
      : (datasources[0]?.id ?? "");
  }, [datasources, defaultDataSourceId]);

  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type: "metric",
    datasource: resolvedDataSourceId,
    dataset: { ...defaultDataset, values: [createEmptyValue("metric")] },
  } as ExplorationConfig;

  return (
    <Box className="position-relative" style={{ padding: "0" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "AI Chat",
          },
        ]}
      />
      <ExplorerProvider initialConfig={defaultDraftState}>
        <ExplorerAIChat />
      </ExplorerProvider>
    </Box>
  );
}
