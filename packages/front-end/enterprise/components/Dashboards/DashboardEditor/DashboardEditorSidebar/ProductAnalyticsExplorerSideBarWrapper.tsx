import { useEffect } from "react";
import {
  DashboardBlockInterfaceOrData,
  DataSourceExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  MetricExplorationBlockInterface,
} from "shared/enterprise";
import ExplorerSideBar from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerSideBar";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

export default function ProductAnalyticsExplorerSideBarWrapper({
  block,
  setBlock,
}: {
  block: DashboardBlockInterfaceOrData<
    | MetricExplorationBlockInterface
    | FactTableExplorationBlockInterface
    | DataSourceExplorationBlockInterface
  >;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<
      | MetricExplorationBlockInterface
      | FactTableExplorationBlockInterface
      | DataSourceExplorationBlockInterface
    >
  >;
}) {
  const { exploreData } = useExplorerContext();

  // When we get a submittedExploreState, persist the analysisId to the block
  useEffect(() => {
    if (
      exploreData &&
      exploreData.analysisId !== block.explorerAnalysisId &&
      exploreData.analysisId !== undefined
    ) {
      setBlock({
        ...block,
        explorerAnalysisId: exploreData.analysisId,
      });
    }
  }, [block, block.explorerAnalysisId, setBlock, exploreData]);

  return <ExplorerSideBar renderingInDashboardSidebar />;
}
