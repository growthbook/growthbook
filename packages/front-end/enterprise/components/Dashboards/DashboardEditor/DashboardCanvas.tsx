import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import { withErrorBoundary } from "@sentry/nextjs";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
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
    return (
      <Frame px="80px" pt="60px" pb="70px">
        <Flex direction="column" align="center" justify="center">
          <Heading as="h2" size="lg" weight="medium" align="center">
            No Blocks Yet
          </Heading>
          <Text align="center">This dashboard has no blocks yet.</Text>
        </Flex>
      </Frame>
    );
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
