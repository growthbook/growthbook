import { useEffect } from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
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
  const { needsUpdate, draftExploreState } = useExplorerContext();

  useEffect(() => {
    if (needsUpdate) {
      setBlock({
        ...block,
        config: draftExploreState,
        explorerAnalysisId: "",
      });
    }
  }, [needsUpdate, setBlock, block, draftExploreState]);
  return <ExplorerSideBar renderingInDashboardSidebar />;
}
