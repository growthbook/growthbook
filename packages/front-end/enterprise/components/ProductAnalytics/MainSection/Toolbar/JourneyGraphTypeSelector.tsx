import { Flex } from "@radix-ui/themes";
import { PiShareNetwork, PiTable, PiWarningBold } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  hasSubmittablePayload,
  journeyPreferredView,
} from "@/enterprise/components/ProductAnalytics/util";
import ExplorerViewSelector, {
  type ExplorerViewOption,
} from "./ExplorerViewSelector";
import JourneyHeightScaleSelector from "./JourneyHeightScaleSelector";

const JOURNEY_GRAPH_ITEMS: ExplorerViewOption[] = [
  { value: "bar", label: "Sankey Diagram", icon: PiShareNetwork },
  { value: "table", label: "Table", icon: PiTable },
];

export default function JourneyGraphTypeSelector() {
  const {
    draftExploreState,
    submittedExploreState,
    changeChartType,
    exploration,
    error,
    loading,
  } = useExplorerContext();

  const hasData = (exploration?.result?.rows?.length ?? 0) > 0;
  const hasDiagram =
    submittedExploreState?.type === "journey" &&
    hasSubmittablePayload(submittedExploreState) &&
    (exploration?.result?.rows.some((row) => (row.journey?.count ?? 0) > 0) ??
      false);
  const hasError = !!error && !loading;
  const showQueryError = hasData && hasError;
  const activeValue = journeyPreferredView({
    chartType: draftExploreState.chartType,
    hasData,
    hasError,
  });

  return (
    <Flex align="center" gap="3">
      <ExplorerViewSelector
        items={JOURNEY_GRAPH_ITEMS}
        value={activeValue}
        disabled={!exploration}
        onChange={changeChartType}
        trailing={
          showQueryError ? (
            <PiWarningBold
              size={16}
              style={{ color: "var(--red-9)", flexShrink: 0 }}
              aria-label="Query error"
            />
          ) : null
        }
      />
      {activeValue === "bar" && (
        <JourneyHeightScaleSelector disabled={!hasDiagram} />
      )}
    </Flex>
  );
}
