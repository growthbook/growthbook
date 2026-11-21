import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  DataSourceExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  FunnelExplorationBlockInterface,
  MarkdownBlockInterface,
  MetricExplorationBlockInterface,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardCanvas from "@/enterprise/components/Dashboards/DashboardEditor/DashboardCanvas";

// Blocks that load their own data. Every other type reads stored results
// that only a saved dashboard can look up.
type UnsavedBlock =
  | MarkdownBlockInterface
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
  | SqlExplorationBlockInterface
  | FunnelExplorationBlockInterface;

// Read-only blocks with no header: the host page supplies its own. Pass a
// saved dashboard, or blocks alone for one that was never saved.
export default function DashboardView(
  props:
    | { dashboard: DashboardInterface }
    | { blocks: DashboardBlockInterfaceOrData<UnsavedBlock>[] },
) {
  const dashboard = "dashboard" in props ? props.dashboard : undefined;
  const blocks = "dashboard" in props ? props.dashboard.blocks : props.blocks;
  // Experiment blocks without a snapshot id read the experiment's latest one
  const experimentId = dashboard?.experimentId;
  const { data: experimentData, error: experimentError } = useApi<{
    experiment: ExperimentInterfaceStringDates;
  }>(`/experiment/${experimentId}`, { shouldRun: () => !!experimentId });

  // On an error, the blocks render without it and show their own states
  if (experimentId && !experimentData && !experimentError) {
    return <LoadingSpinner />;
  }

  return (
    <DashboardSnapshotProvider
      dashboard={dashboard}
      experiment={experimentData?.experiment}
      mutateDefinitions={() => undefined}
    >
      <DashboardCanvas
        isTabActive
        // An empty experimentId marks a general dashboard
        isGeneralDashboard={!experimentId}
        blocks={blocks}
        globalControls={dashboard?.globalControls}
        dashboardComparison={dashboard?.comparison}
        selfUpdate
      />
    </DashboardSnapshotProvider>
  );
}
