import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardCanvas from "@/enterprise/components/Dashboards/DashboardEditor/DashboardCanvas";

// Read-only blocks with no header: the host page supplies its own. Pass a
// saved dashboard, or blocks alone for one that was never saved.
export default function DashboardView(
  props:
    | { dashboard: DashboardInterface }
    | { blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[] },
) {
  const dashboard = "dashboard" in props ? props.dashboard : undefined;
  const blocks = "dashboard" in props ? props.dashboard.blocks : props.blocks;

  return (
    <DashboardSnapshotProvider
      dashboard={dashboard}
      mutateDefinitions={() => undefined}
    >
      <DashboardCanvas
        isTabActive
        isGeneralDashboard
        blocks={blocks}
        globalControls={dashboard?.globalControls}
        dashboardComparison={dashboard?.comparison}
      />
    </DashboardSnapshotProvider>
  );
}
