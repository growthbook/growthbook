import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  blockUsesDashboardDateControl,
  isDashboardGlobalControlSupportedBlock,
  isDashboardExperimentBlock,
  experimentBlockOptedOutOfGlobalFilters,
} from "shared/enterprise";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor/dashboardBlockTypes";
import DashboardBlockContent from "./DashboardBlockContent";
export type { BlockProps } from "./DashboardBlockContent";

export default function DashboardBlock({
  block,
  dashboardGlobalControls,
  dashboardComparison,
  blockIndex,
  isTabActive = true,
  actions,
}: {
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  blockIndex?: number;
  isTabActive?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <Flex
      className="appbox dashboard-block px-4 py-3 mb-0 position-relative"
      style={{ overflow: "auto", height: "100%", width: "100%" }}
      direction="column"
    >
      <Flex align="center" mb="2" justify="between">
        <h4
          style={{
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {block.title ||
            (block.type === "markdown" ? "" : BLOCK_TYPE_INFO[block.type].name)}
        </h4>
        {dashboardGlobalControls?.dateRange &&
          isDashboardGlobalControlSupportedBlock(block) &&
          !blockUsesDashboardDateControl(block) && (
            <Badge
              label="Uses block date filter"
              color="gray"
              variant="soft"
              size="xs"
              ml="2"
            />
          )}
        {isDashboardExperimentBlock(block) &&
          experimentBlockOptedOutOfGlobalFilters(
            block,
            dashboardGlobalControls,
          ) && (
            <Badge
              label="Uses block filters"
              color="gray"
              variant="soft"
              size="xs"
              ml="2"
            />
          )}
        {actions}
      </Flex>
      <Text>{block.description}</Text>
      <DashboardBlockContent
        block={block}
        dashboardGlobalControls={dashboardGlobalControls}
        dashboardComparison={dashboardComparison}
        blockIndex={blockIndex}
        isTabActive={isTabActive}
      />
    </Flex>
  );
}
