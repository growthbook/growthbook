import { PiShareNetwork, PiTable, PiWarningBold } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { journeyPreferredView } from "@/enterprise/components/ProductAnalytics/util";
import ExplorerViewSelector, {
  type ExplorerViewOption,
} from "./ExplorerViewSelector";

const JOURNEY_GRAPH_ITEMS: ExplorerViewOption[] = [
  { value: "bar", label: "Visualization", icon: PiShareNetwork },
  { value: "table", label: "Results / SQL", icon: PiTable },
];

export default function JourneyGraphTypeSelector() {
  const { draftExploreState, changeChartType, exploration, error, loading } =
    useExplorerContext();

  const hasData = (exploration?.result?.rows?.length ?? 0) > 0;
  const hasError = !!error && !loading;
  const showQueryError = hasData && hasError;
  const activeValue = journeyPreferredView({
    chartType: draftExploreState.chartType,
    hasData,
    hasError,
  });

  return (
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
  );
}
