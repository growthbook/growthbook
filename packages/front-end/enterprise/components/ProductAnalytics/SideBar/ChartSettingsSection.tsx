import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import Collapsible from "react-collapsible";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  CHART_TYPES_WITH_AXES,
  canSeparateValueCharts,
  getDefaultValueAxisName,
  showsSeparateValueCharts,
  valuesMixMetricClasses,
  getExplorationRenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

type AxisLabelKey = "categoryAxisLabel" | "valueAxisLabel";

export default function ChartSettingsSection() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { getFactMetricById } = useDefinitions();
  // Open if any visible setting is customized ("" = hidden label, still
  // custom). anchorYAxisToZero persists across chart types but only shows for
  // line charts, so it only counts there.
  const [isCollapsed, setIsCollapsed] = useState(
    () =>
      draftExploreState.chartSettings?.categoryAxisLabel === undefined &&
      draftExploreState.chartSettings?.valueAxisLabel === undefined &&
      !draftExploreState.chartSettings?.separateValueCharts &&
      (draftExploreState.chartType !== "line" ||
        draftExploreState.chartSettings?.anchorYAxisToZero === undefined),
  );

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
    getExplorationRenderOpts(draftExploreState, getFactMetricById),
  );
  const labels = draftExploreState.chartSettings;
  const isLineChart = draftExploreState.chartType === "line";
  const valueNoun =
    draftExploreState.dataset.type === "metric" ? "metric" : "value";
  const separateCharts = showsSeparateValueCharts(
    draftExploreState,
    getFactMetricById,
  );
  const mustSeparate = valuesMixMetricClasses(
    draftExploreState,
    getFactMetricById,
  );

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
          aria-label={
            isCollapsed ? "Expand chart settings" : "Collapse chart settings"
          }
          aria-expanded={!isCollapsed}
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
          {canSeparateValueCharts(draftExploreState) && (
            <Switch
              label={`Separate chart per ${valueNoun}`}
              description={`${
                mustSeparate
                  ? "Ratio and quantile metrics always chart separately from other metric types."
                  : `Each ${valueNoun} gets its own chart and value axis.`
              } Charts are titled with the ${valueNoun} name instead of a shared axis label.`}
              value={separateCharts}
              disabled={mustSeparate}
              onChange={(separateValueCharts) =>
                setDraftExploreState((prev) => ({
                  ...prev,
                  chartSettings: {
                    ...prev.chartSettings,
                    separateValueCharts,
                  },
                }))
              }
            />
          )}
          {/* Each separate chart labels its own value axis */}
          {!(separateCharts && xAxisKey === "valueAxisLabel") && (
            <TextField
              label="X-axis label"
              value={
                labels?.[xAxisKey] ??
                (isHorizontalBar ? defaultValueAxisLabel : "")
              }
              onChange={(e) => updateAxisLabel(xAxisKey, e.target.value)}
            />
          )}
          {!(separateCharts && yAxisKey === "valueAxisLabel") && (
            <TextField
              label="Y-axis label"
              value={
                labels?.[yAxisKey] ??
                (isHorizontalBar ? "" : defaultValueAxisLabel)
              }
              onChange={(e) => updateAxisLabel(yAxisKey, e.target.value)}
            />
          )}
          {isLineChart && (
            <Switch
              label="Anchor y-axis to zero"
              description="Turn off to fit the axis to the data range."
              value={labels?.anchorYAxisToZero ?? true}
              onChange={(anchorYAxisToZero) =>
                setDraftExploreState((prev) => ({
                  ...prev,
                  chartSettings: {
                    ...prev.chartSettings,
                    anchorYAxisToZero,
                  },
                }))
              }
            />
          )}
        </Flex>
      </Collapsible>
    </Flex>
  );
}
