import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";

const noop = () => undefined;

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
    <DashboardSnapshotProvider dashboard={dashboard} mutateDefinitions={noop}>
      <DashboardEditor
        hideHeader
        isTabActive
        isGeneralDashboard
        isEditing={false}
        id={dashboard?.id ?? "new"}
        title={dashboard?.title ?? ""}
        blocks={blocks}
        globalControls={dashboard?.globalControls}
        dashboardComparison={dashboard?.comparison}
        projects={dashboard?.projects ?? []}
        ownerId={dashboard?.userId ?? ""}
        dashboardOwnerId={dashboard?.userId ?? ""}
        initialEditLevel={dashboard?.editLevel ?? "private"}
        initialShareLevel={dashboard?.shareLevel ?? "private"}
        enableAutoUpdates={false}
        updateSchedule={undefined}
        nextUpdate={undefined}
        setBlock={undefined}
        mutate={noop}
      />
    </DashboardSnapshotProvider>
  );
}
