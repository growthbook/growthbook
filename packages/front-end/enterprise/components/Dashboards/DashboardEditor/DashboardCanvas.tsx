import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import { withErrorBoundary } from "@sentry/nextjs";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { DashboardChartsProvider } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import DashboardBlock from "./DashboardBlock";
import DashboardGrid from "./DashboardGrid";

function DashboardCanvas({
  blocks,
  globalControls,
  dashboardComparison,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
}) {
  if (blocks.length === 0) {
    // Kept compact: this renders inside embeds like the home page card.
    return <Text color="text-mid">This dashboard has no blocks yet.</Text>;
  }

  return (
    <DashboardChartsProvider>
      <DashboardGrid
        blocks={blocks}
        renderBlock={(block, i) => (
          <DashboardBlock
            isTabActive
            block={block}
            dashboardGlobalControls={globalControls}
            dashboardComparison={dashboardComparison}
            blockIndex={i}
          />
        )}
      />
    </DashboardChartsProvider>
  );
}

export default withErrorBoundary(DashboardCanvas, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
