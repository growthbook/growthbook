import { Flex } from "@radix-ui/themes";
import { BsGraphUpArrow } from "react-icons/bs";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import Toolbar from "./Toolbar";

export default function ExplorerMainSection() {
  const { exploration, submittedExploreState, loading, error } =
    useExplorerContext();

  return (
    <Flex direction="column" px="2" py="3" gap="4">
      <Toolbar />

      {submittedExploreState?.dataset?.values?.length &&
      submittedExploreState?.dataset?.values?.length > 0 ? (
        <Flex direction="column" gap="3">
          <ExplorerChart
            exploration={exploration}
            error={error}
            submittedExploreState={submittedExploreState}
            loading={loading}
          />
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
          <Text size="large" weight="medium">
            Configure your explorer to visualize data
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
