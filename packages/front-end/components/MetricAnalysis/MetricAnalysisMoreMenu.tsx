import { BsArrowRepeat } from "react-icons/bs";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";

export default function MetricAnalysisMoreMenu({
  metricAnalysis,
  forceRefresh,
  canRunMetricQuery,
}: {
  metricAnalysis?: MetricAnalysisInterface | null;
  forceRefresh?: () => Promise<void>;
  canRunMetricQuery?: boolean;
}) {
  return (
    <MoreMenu autoCloseOnClick={false}>
      {(metricAnalysis?.queries?.length ?? 0) > 0 && (
        <ViewAsyncQueriesButton
          queries={metricAnalysis?.queries.map((q) => q.query) ?? []}
          color={metricAnalysis?.status === "error" ? "danger" : "info"}
          error={metricAnalysis?.error}
          className="dropdown-item py-2"
        />
      )}
      {forceRefresh && canRunMetricQuery && (
        <button
          className="btn dropdown-item py-2"
          onClick={(e) => {
            e.preventDefault();
            forceRefresh();
          }}
        >
          <BsArrowRepeat className="mr-2" /> Force Query Re-Run
        </button>
      )}
    </MoreMenu>
  );
}
