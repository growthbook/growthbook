import { DashboardInterface } from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

// Read-only embed: renders a dashboard's blocks without any editing affordances.
// DashboardEditor only shows its edit entry points when setIsEditing/setBlock
// are provided, so omitting them here is enough to make this view-only.
export default function DashboardView({
  dashboardId,
  maxBlocks,
  showHeader = true,
}: {
  dashboardId: string;
  // When set, only the first N blocks render (in the dashboard's own saved
  // order/sizing) instead of shrinking or reflowing everything to fit a
  // smaller space. A "View full dashboard" link covers the rest.
  maxBlocks?: number;
  // Independent of maxBlocks — a caller may want a capped block count with
  // the header still shown, or a full-block embed without it.
  showHeader?: boolean;
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

  const visibleBlocks = maxBlocks
    ? dashboard.blocks.slice(0, maxBlocks)
    : dashboard.blocks;
  const hasHiddenBlocks = visibleBlocks.length < dashboard.blocks.length;

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
        blocks={visibleBlocks}
        globalControls={dashboard.globalControls}
        enableAutoUpdates={dashboard.enableAutoUpdates}
        setBlock={undefined}
        projects={dashboard.projects ? dashboard.projects : []}
        mutate={mutate}
        updateSchedule={dashboard.updateSchedule || undefined}
        nextUpdate={dashboard.nextUpdate}
        dashboardLastUpdated={dashboard.lastUpdated}
        dashboardComparison={dashboard.comparison}
        showHeader={showHeader}
      />
      {hasHiddenBlocks && (
        <Flex justify="end" mt="2">
          <Link href={`/product-analytics/dashboards/${dashboard.id}`}>
            View full dashboard <PiArrowRight />
          </Link>
        </Flex>
      )}
    </DashboardSnapshotProvider>
  );
}
