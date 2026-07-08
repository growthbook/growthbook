import { Box, Flex } from "@radix-ui/themes";
import { useState } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Field from "@/components/Forms/Field";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

type AxisLabelKey = "categoryAxisLabel" | "valueAxisLabel";

const CHART_TYPES_WITH_AXES = new Set([
  "line",
  "area",
  "bar",
  "stackedBar",
  "horizontalBar",
  "stackedHorizontalBar",
]);

const HORIZONTAL_BAR_CHART_TYPES = new Set([
  "horizontalBar",
  "stackedHorizontalBar",
]);

export default function ChartSettingsSection() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (!CHART_TYPES_WITH_AXES.has(draftExploreState.chartType)) return null;

  const axes = draftExploreState.chartSettings?.axes;
  const isHorizontalBar = HORIZONTAL_BAR_CHART_TYPES.has(
    draftExploreState.chartType,
  );
  const xAxisKey: AxisLabelKey = isHorizontalBar
    ? "valueAxisLabel"
    : "categoryAxisLabel";
  const yAxisKey: AxisLabelKey = isHorizontalBar
    ? "categoryAxisLabel"
    : "valueAxisLabel";

  const updateAxisLabel = (key: AxisLabelKey, value: string) => {
    setDraftExploreState((prev) => ({
      ...prev,
      chartSettings: {
        ...prev.chartSettings,
        axes: {
          ...prev.chartSettings?.axes,
          [key]: value,
        },
      },
    }));
  };

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Text weight="medium">Chart Settings</Text>
        </Box>
        <Flex align="center" style={{ flexShrink: 0 }}>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setIsCollapsed((prev) => !prev)}
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <PiCaretDown size={14} /> : <PiCaretUp size={14} />}
          </Button>
        </Flex>
      </Flex>
      <Collapsible
        transitionTime={100}
        open={!isCollapsed}
        trigger=""
        triggerDisabled
      >
        <Flex direction="column" gap="3" mt="2">
          <Flex
            direction="column"
            px="3"
            pt="3"
            style={{
              border: "1px solid var(--gray-a3)",
              borderRadius: "var(--radius-3)",
              backgroundColor: "var(--color-panel-translucent)",
            }}
          >
            <Field
              label="X-axis Label"
              placeholder="Default"
              value={axes?.[xAxisKey] ?? ""}
              onChange={(e) => updateAxisLabel(xAxisKey, e.target.value)}
            />
            <Field
              label="Y-axis Label"
              placeholder="Default"
              value={axes?.[yAxisKey] ?? ""}
              onChange={(e) => updateAxisLabel(yAxisKey, e.target.value)}
            />
          </Flex>
        </Flex>
      </Collapsible>
    </Box>
  );
}
