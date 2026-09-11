import { DashboardInterface } from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import { PiArrowRight } from "react-icons/pi";
import Link from "@/ui/Link";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardCanvas from "@/enterprise/components/Dashboards/DashboardEditor/DashboardCanvas";
import { getPreviewBlocks } from "@/enterprise/components/Dashboards/DashboardEditor/dashboardLayout";

export default function DashboardView({
  dashboard,
  maxBlocks,
  mutate,
}: {
  dashboard: DashboardInterface;
  maxBlocks?: number;
  mutate?: () => void;
}) {
  const visibleBlocks = getPreviewBlocks(dashboard.blocks, maxBlocks);
  const hasHiddenBlocks = visibleBlocks.length < dashboard.blocks.length;
  const previewDashboard =
    visibleBlocks === dashboard.blocks
      ? dashboard
      : { ...dashboard, blocks: visibleBlocks };

  return (
    <DashboardSnapshotProvider
      dashboard={previewDashboard}
      mutateDefinitions={mutate ?? (() => undefined)}
    >
      <DashboardCanvas
        blocks={visibleBlocks}
        globalControls={dashboard.globalControls}
        dashboardComparison={dashboard.comparison}
        isGeneralDashboard
        mutate={mutate}
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
