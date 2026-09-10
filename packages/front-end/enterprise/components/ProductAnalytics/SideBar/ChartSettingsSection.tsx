import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import Collapsible from "react-collapsible";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { getDefaultValueAxisName } from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

type AxisLabelKey = "categoryAxisLabel" | "valueAxisLabel";

const CHART_TYPES_WITH_AXES = new Set([
  "line",
  "area",
  "bar",
  "stackedBar",
  "horizontalBar",
  "stackedHorizontalBar",
]);

export default function ChartSettingsSection() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { getFactMetricById } = useDefinitions();
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!CHART_TYPES_WITH_AXES.has(draftExploreState.chartType)) return null;

  const isHorizontalBar =
    draftExploreState.chartType === "horizontalBar" ||
    draftExploreState.chartType === "stackedHorizontalBar";
  const xAxisKey: AxisLabelKey = isHorizontalBar
    ? "valueAxisLabel"
    : "categoryAxisLabel";
  const yAxisKey: AxisLabelKey = isHorizontalBar
    ? "categoryAxisLabel"
    : "valueAxisLabel";

  const defaultValueAxisLabel = getDefaultValueAxisName(
    draftExploreState,
    getFactMetricById,
  );
  const labels = draftExploreState.chartSettings;

  const updateAxisLabel = (key: AxisLabelKey, value: string) => {
    setDraftExploreState((prev) => ({
      ...prev,
      chartSettings: {
        ...prev.chartSettings,
        [key]: value,
      },
    }));
  };

  return (
    <Flex
      direction="column"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Text weight="medium">Chart Settings</Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed((prev) => !prev)}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <PiCaretDown size={14} /> : <PiCaretUp size={14} />}
        </Button>
      </Flex>
      <Collapsible
        open={!isCollapsed}
        trigger=""
        triggerDisabled
        transitionTime={100}
      >
        <Flex direction="column" gap="2" mt="2">
          <TextField
            label="X-axis label"
            value={
              labels?.[xAxisKey] ??
              (isHorizontalBar ? defaultValueAxisLabel : "")
            }
            onChange={(e) => updateAxisLabel(xAxisKey, e.target.value)}
          />
          <TextField
            label="Y-axis label"
            value={
              labels?.[yAxisKey] ??
              (isHorizontalBar ? "" : defaultValueAxisLabel)
            }
            onChange={(e) => updateAxisLabel(yAxisKey, e.target.value)}
          />
        </Flex>
      </Collapsible>
    </Flex>
  );
}
