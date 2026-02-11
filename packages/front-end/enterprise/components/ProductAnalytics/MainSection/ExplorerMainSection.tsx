import { Flex, Text } from "@radix-ui/themes";
import { PiArrowsClockwise } from "react-icons/pi";
import { BsGraphUpArrow } from "react-icons/bs";
import Button from "@/ui/Button";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import GraphTypeSelector from "./Toolbar/GraphTypeSelector";
import DateRangePicker from "./Toolbar/DateRangePicker";
import GranularitySelector from "./Toolbar/GranularitySelector";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";

export default function ExplorerMainSection() {
  const {
    draftExploreState,
    submittedExploreState,
    loading,
    handleSubmit,
  } = useExplorerContext();

  return (
    <Flex direction="column" px="2" py="3" gap="4">
      <Flex justify="between" align="center" height="32px">
        <Flex align="center" gap="3">
          <GraphTypeSelector />
        </Flex>
        <Flex align="center" gap="3">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !draftExploreState?.dataset?.values?.length}
            onClick={handleSubmit}
          >
            <PiArrowsClockwise style={{ marginRight: "8px" }} />
            Update
          </Button>
          <DateRangePicker />
          {["line", "area"].includes(draftExploreState.chartType) && (
            <GranularitySelector />
          )}
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
          <BsGraphUpArrow size={48} className="text-muted" />
          <Text size="3" weight="medium">
            Configure your explorer to visualize data
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
