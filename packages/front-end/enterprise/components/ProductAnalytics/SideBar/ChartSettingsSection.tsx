import { Flex } from "@radix-ui/themes";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
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
      gap="2"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Text weight="medium">Chart Settings</Text>
      <TextField
        label="X-axis label"
        placeholder="Default"
        value={draftExploreState.chartSettings?.[xAxisKey] ?? ""}
        onChange={(e) => updateAxisLabel(xAxisKey, e.target.value)}
      />
      <TextField
        label="Y-axis label"
        placeholder="Default"
        value={draftExploreState.chartSettings?.[yAxisKey] ?? ""}
        onChange={(e) => updateAxisLabel(yAxisKey, e.target.value)}
      />
    </Flex>
  );
}
