import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";
import ChartTypeConfigSection from "./ChartTypeConfigSection";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
}

export default function DataVisualizationSettings({ block, setBlock }: Props) {
  return (
    <Flex direction="column" gap="3" mb="3">
      <Flex
        direction="column"
        height="100%"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          overflow: "hidden",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <ChartTypeConfigSection block={block} setBlock={setBlock} />
      </Flex>
    </Flex>
  );
}
