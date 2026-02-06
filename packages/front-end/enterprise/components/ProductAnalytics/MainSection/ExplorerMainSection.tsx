import { Flex, Text } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { useExplorerContext } from "../ExplorerContext";
import GraphTypeSelector from "./Toolbar/GraphTypeSelector";
import DateRangePicker from "./Toolbar/DateRangePicker";
import GranularitySelector from "./Toolbar/GranularitySelector";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import Tooltip from "@/components/Tooltip/Tooltip";
import { PiArrowsClockwise, PiCode, PiPlus, PiTable } from "react-icons/pi";
import { BsFillBarChartLineFill, BsGraphUpArrow } from "react-icons/bs";

export default function ExplorerMainSection() {
    const { draftExploreState, submittedExploreState, loading, handleSubmit, changeDatasetType } =
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
                        variant="outline"
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
                    <BsGraphUpArrow
                        size={48}
                        className="text-muted"
                    />
                    <Text size="3" weight="medium">
                        Select an Explorer Type
                    </Text>
                    <Text size="2" style={{ maxWidth: 350, textAlign: "center" }} className="text-muted">
                        Choose how you want to explore your data
                    </Text>
                    <Flex gap="3" mt="3">
                        <Button variant="outline" style={{ height: "116px", paddingTop: "16px", paddingBottom: "16px", width: "160px" }} onClick={() => changeDatasetType("metric")}>
                            <Flex direction="column" align="center" gap="1">
                                <BsFillBarChartLineFill size={24} />
                                <Text size="2" weight="medium">
                                    Metrics
                                </Text>
                                <Text size="1" className="text-muted">
                                    Pre-built metrics
                                </Text>
                            </Flex>
                        </Button>
                        <Button variant="outline" style={{ height: "116px", paddingTop: "16px", paddingBottom: "16px", width: "160px" }} onClick={() => changeDatasetType("fact_table")}>
                            <Flex direction="column" align="center" gap="1">
                                <PiTable size={24} />
                                <Text size="2" weight="medium">
                                    Fact Table
                                </Text>
                                <Text size="1" className="text-muted">
                                    Build custom queries
                                </Text>
                            </Flex>
                        </Button>
                        <Button variant="outline" style={{ height: "116px", paddingTop: "16px", paddingBottom: "16px", width: "160px" }} onClick={() => changeDatasetType("sql")}>
                            <Flex direction="column" align="center" gap="1">
                                <PiCode size={24} />
                                <Text size="2" weight="medium">
                                    SQL
                                </Text>
                                <Text size="1" className="text-muted">
                                    Write SQL queries
                                </Text>
                            </Flex>
                        </Button>
                    </Flex>
                </Flex>
            )}
        </Flex>
    );
}
