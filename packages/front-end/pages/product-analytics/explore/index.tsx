import React from "react";
import { Box } from "@radix-ui/themes";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import EmptyState from "@/enterprise/components/ProductAnalytics/EmptyState";
import {
  ExplorerProvider,
  useDefaultDataSourceId,
} from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyDataset,
  createEmptyValue,
} from "@/enterprise/components/ProductAnalytics/util";

export default function ExplorePage() {
  const defaultDataset = createEmptyDataset("metric");
  const defaultDataSourceId = useDefaultDataSourceId();

  const defaultDraftState = {
    ...DEFAULT_EXPLORE_STATE,
    type: "metric",
    datasource: defaultDataSourceId,
    dataset: { ...defaultDataset, values: [createEmptyValue("metric")] },
  } as ExplorationConfig;

  return (
    <Box
      // Full height, so not in the page wrapper, but with its side padding.
      className="position-relative page-sides"
      style={{
        display: "flex",
        flex: 1,
        flexDirection: "column",
        // 24px under the header, as on pages in the wrapper.
        paddingTop: "24px",
        paddingBottom: "15px",
      }}
    >
      <Box
        width="100%"
        style={{ display: "flex", flex: 1, flexDirection: "column" }}
      >
        <ExplorerProvider initialConfig={defaultDraftState}>
          <EmptyState />
        </ExplorerProvider>
      </Box>
    </Box>
  );
}

ExplorePage.mainClassName = "product-analytics-explore-landing";
ExplorePage.noPageWrapper = true;
