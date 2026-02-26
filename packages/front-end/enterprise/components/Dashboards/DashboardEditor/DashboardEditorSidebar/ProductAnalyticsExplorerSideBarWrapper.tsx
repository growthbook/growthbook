import { useEffect, useRef } from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { isEqual } from "lodash";
import ExplorerSideBar from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerSideBar";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";

export default function ProductAnalyticsExplorerSideBarWrapper({
  block,
  setBlock,
  saveAndCloseTrigger,
  onSaveAndClose,
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
  saveAndCloseTrigger?: number;
  onSaveAndClose?: () => void;
}) {
  const { needsUpdate, draftExploreState, handleSubmit } = useExplorerContext();
  const pendingCloseRef = useRef(false);
  const onSaveAndCloseRef = useRef(onSaveAndClose);
  onSaveAndCloseRef.current = onSaveAndClose;

  const explorerAnalysisId =
    "explorerAnalysisId" in block ? block.explorerAnalysisId : undefined;

  useEffect(() => {
    if (needsUpdate && !isEqual(block.config, draftExploreState)) {
      setBlock({
        ...block,
        config: draftExploreState,
        explorerAnalysisId: "",
      });
    }
  }, [needsUpdate, setBlock, block, draftExploreState]);

  // When Save & Close is requested and the block is stale, run the analysis first.
  useEffect(() => {
    if (!saveAndCloseTrigger) return;
    pendingCloseRef.current = true;
    handleSubmit();
  }, [saveAndCloseTrigger, handleSubmit]);

  // Once onRunComplete fires and sets explorerAnalysisId, complete the save.
  useEffect(() => {
    if (pendingCloseRef.current && explorerAnalysisId) {
      pendingCloseRef.current = false;
      onSaveAndCloseRef.current?.();
    }
  }, [explorerAnalysisId]);

  return <ExplorerSideBar renderingInDashboardSidebar />;
}
