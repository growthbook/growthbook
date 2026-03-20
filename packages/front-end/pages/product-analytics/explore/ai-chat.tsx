import React from "react";
import { Box } from "@radix-ui/themes";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import PageHead from "@/components/Layout/PageHead";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerAIChat from "@/enterprise/components/ProductAnalytics/ExplorerAIChat";
import { ExplorerProvider } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyDataset,
  createEmptyValue,
} from "@/enterprise/components/ProductAnalytics/util";

function AIChatPageContent() {
  return <ExplorerAIChat />;
}

export default function AIChatExplorePage() {
  const { datasources } = useDefinitions();
  const defaultDataset = createEmptyDataset("metric");
  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type: "metric",
    datasource: datasources[0]?.id || "",
    dataset: { ...defaultDataset, values: [createEmptyValue("metric")] },
  } as ExplorationConfig;

  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
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
        <AIChatPageContent />
      </ExplorerProvider>
    </Box>
  );
}
