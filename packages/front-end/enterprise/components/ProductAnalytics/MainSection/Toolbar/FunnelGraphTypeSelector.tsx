import { PiFunnel, PiTable } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import ExplorerViewSelector, {
  type ExplorerViewOption,
} from "./ExplorerViewSelector";

const FUNNEL_GRAPH_ITEMS: ExplorerViewOption[] = [
  { value: "bar", label: "Funnel", icon: PiFunnel },
  { value: "table", label: "Funnel Table", icon: PiTable },
];

export default function FunnelGraphTypeSelector() {
  const { draftExploreState, changeChartType } = useExplorerContext();

  // Treat any non-"table" chartType as the funnel chart view so we don't
  // strand a previously-saved chartType like "line" on a stale config.
  const activeValue: "bar" | "table" =
    draftExploreState.chartType === "table" ? "table" : "bar";

  return (
    <ExplorerViewSelector
      items={FUNNEL_GRAPH_ITEMS}
      value={activeValue}
      onChange={changeChartType}
    />
  );
}
