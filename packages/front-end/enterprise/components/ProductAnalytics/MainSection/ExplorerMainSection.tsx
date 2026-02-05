import { Button, Flex, Text } from "@radix-ui/themes";
import { useExplorerContext } from "../ExplorerContext";
import GraphTypeSelector from "./Toolbar/GraphTypeSelector";
import DateRangePicker from "./Toolbar/DateRangePicker";
import GranularitySelector from "./Toolbar/GranularitySelector";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import Tooltip from "@/components/Tooltip/Tooltip";
import { PiArrowsClockwise, PiPlus } from "react-icons/pi";

export default function ExplorerMainSection() {
  const { draftExploreState, submittedExploreState, loading, handleSubmit } =
    useExplorerContext();

  return (
    <Flex direction="column" px="2" py="3" gap="3">
      <Flex justify="between" align="center">
        <Flex align="center" gap="3">
          <GraphTypeSelector />
        </Flex>
        <Flex align="center" gap="3">
          <Button
            size="2"
            variant="solid"
            disabled={loading || !draftExploreState?.dataset?.values?.length}
            onClick={handleSubmit}
          >
            <PiArrowsClockwise />
            Update
          </Button>
          <DateRangePicker />
          {draftExploreState.chartType === "line" && <GranularitySelector />}
        </Flex>
      </Flex>

      {submittedExploreState?.dataset?.values?.length &&
      submittedExploreState?.dataset?.values?.length > 0 ? (
        <Flex direction="column" gap="3">
          <ExplorerChart />
          <ExplorerDataTable />
        </Flex>
      ) : (
        <Flex
          align="center"
          justify="center"
          direction="column"
          gap="3"
          style={{
            minHeight: "400px",
            color: "var(--color-text-mid)",
            border: "2px dashed var(--gray-a3)",
            borderRadius: "var(--radius-4)",
          }}
        >
          <PiPlus size={32} style={{ opacity: 0.5 }} />
          <Text size="3" weight="medium">
            Add a series to get started
          </Text>
          <Text size="2" style={{ maxWidth: 350, textAlign: "center" }}>
            Use the sidebar to add metrics, fact table queries, or SQL to
            visualize your data
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
