import { Button, Flex, Text } from "@radix-ui/themes";
import { useExplorerContext } from "../ExplorerContext";
import GraphTypeSelector from "./Toolbar/GraphTypeSelector";
import DateRangePicker from "./Toolbar/DateRangePicker";
import GranularitySelector from "./Toolbar/GranularitySelector";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import Tooltip from "@/components/Tooltip/Tooltip";
import { getSeriesTag } from "../util";
import { PiArrowsClockwise, PiPlus } from "react-icons/pi";

export default function ExplorerMainSection() {
    const { draftExploreState, submittedExploreState, exploreData, loading, handleSubmit, hasPendingChanges } = useExplorerContext();

    return (
        <Flex direction="column" px="2" py="3" gap="3">
            <Flex justify="between" align="center">
                <Flex align="center" gap="3">

                    <GraphTypeSelector/>

                    {/* Show series tags being visualized */}
                    <Flex align="center" gap="1" display={!submittedExploreState?.dataset?.values.length ? "none" : undefined} >
                        <Text size="1" style={{ color: "var(--gray-9)" }}>
                            Showing:
                        </Text>
                        {submittedExploreState?.dataset?.values.map((seriesItem, index) => (
                            <Tooltip
                                key={index}
                                body={seriesItem.name}
                            >
                                <Flex
                                    align="center"
                                    justify="center"
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "var(--radius-2)",
                                        backgroundColor: seriesItem.color || "var(--gray-9)",
                                        color: "white",
                                        fontSize: "11px",
                                        fontWeight: 600,
                                    }}
                                >
                                    {seriesItem.tag ?? getSeriesTag(index)}
                                </Flex>
                            </Tooltip>
                        ))}
                    </Flex>
                </Flex>
                <Flex align="center" gap="3">
                    <Button
                        size="2"
                        variant="solid"
                        disabled={!hasPendingChanges || loading || !draftExploreState?.dataset?.values?.length}
                        onClick={handleSubmit}
                    >
                        <PiArrowsClockwise />
                        Update
                    </Button>
                    <DateRangePicker />
                    <GranularitySelector />
                </Flex>
            </Flex>

            {submittedExploreState?.dataset?.values?.length && submittedExploreState?.dataset?.values?.length > 0 ? (
                <>
                    <ExplorerChart />
                    <ExplorerDataTable />
                </>
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