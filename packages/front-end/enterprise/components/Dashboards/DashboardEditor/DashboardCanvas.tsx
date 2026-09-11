import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
} from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { DashboardChartsProvider } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import DashboardBlock from "./DashboardBlock";
import DashboardGrid from "./DashboardGrid";

export default function DashboardCanvas({
  blocks,
  globalControls,
  dashboardComparison,
  isGeneralDashboard = true,
  mutate,
}: {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  isGeneralDashboard?: boolean;
  mutate?: () => void;
}) {
  if (blocks.length === 0) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        px="80px"
        pt="60px"
        pb="70px"
        className="appbox"
        gap="5"
      >
        <Flex direction="column">
          <Heading as="h1" size="lg" weight="medium" align="center">
            No Blocks Yet
          </Heading>
          <Text align="center">This dashboard has no blocks yet.</Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <DashboardChartsProvider>
      <DashboardGrid
        blocks={blocks}
        isEditing={false}
        editSidebarDirty={false}
        stagedBlockIndex={undefined}
        isAddingBlock={false}
        updateLayout={undefined}
        addBlockType={undefined}
        isGeneralDashboard={isGeneralDashboard}
        renderBlock={(block, i) => (
          <DashboardBlock
            isTabActive
            block={block}
            dashboardGlobalControls={globalControls}
            dashboardComparison={dashboardComparison}
            blockIndex={i}
            isEditing={false}
            isFocused={false}
            editingBlock={false}
            canMoveBlock={false}
            disableBlock="none"
            scrollAreaRef={null}
            setBlock={undefined}
            editBlock={() => undefined}
            duplicateBlock={() => undefined}
            deleteBlock={() => undefined}
            isGeneralDashboard={isGeneralDashboard}
            mutate={mutate ?? (() => undefined)}
            canEdit={false}
          />
        )}
      />
    </DashboardChartsProvider>
  );
}
