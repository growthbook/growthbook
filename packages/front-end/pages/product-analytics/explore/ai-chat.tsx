import { Box } from "@radix-ui/themes";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import PageHead from "@/components/Layout/PageHead";
import ExplorerAIChat from "@/enterprise/components/ProductAnalytics/AIChat/ExplorerAIChat";
import {
  ExplorerProvider,
  useDefaultDataSourceId,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyDataset,
  createEmptyValue,
} from "@/enterprise/components/ProductAnalytics/util";

export default function AIChatExplorePage() {
  const defaultDataset = createEmptyDataset("metric");

  const defaultDataSourceId = useDefaultDataSourceId();

  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type: "metric",
    datasource: defaultDataSourceId,
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
