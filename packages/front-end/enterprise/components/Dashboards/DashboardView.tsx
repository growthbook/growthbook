import { DashboardInterface } from "shared/enterprise";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

// Read-only embed: renders a dashboard's blocks without any editing affordances.
// DashboardEditor only shows its edit entry points when setIsEditing/setBlock
// are provided, so omitting them here is enough to make this view-only.
export default function DashboardView({
  dashboardId,
}: {
  dashboardId: string;
}) {
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${dashboardId}`, {
    shouldRun: () => Boolean(dashboardId),
  });
  const dashboard = data?.dashboard;

  if (isLoading) {
    return <LoadingOverlay relativePosition />;
  }

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }

  if (!dashboard) {
    return <Callout status="error">Dashboard not found</Callout>;
  }

  return (
    <DashboardSnapshotProvider dashboard={dashboard} mutateDefinitions={mutate}>
      <DashboardEditor
        isTabActive
        id={dashboard.id}
        initialEditLevel={dashboard.editLevel}
        ownerId={dashboard.userId}
        initialShareLevel={dashboard.shareLevel}
        dashboardOwnerId={dashboard.userId}
        isGeneralDashboard={true}
        isEditing={false}
        title={dashboard.title}
        blocks={dashboard.blocks}
        globalControls={dashboard.globalControls}
        enableAutoUpdates={dashboard.enableAutoUpdates}
        setBlock={undefined}
        projects={dashboard.projects ? dashboard.projects : []}
        mutate={mutate}
        updateSchedule={dashboard.updateSchedule || undefined}
        nextUpdate={dashboard.nextUpdate}
        dashboardLastUpdated={dashboard.lastUpdated}
        dashboardComparison={dashboard.comparison}
      />
    </DashboardSnapshotProvider>
  );
}
