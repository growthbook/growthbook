import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Tooltip from "@/components/Tooltip/Tooltip";
import SqlQuerySection from "@/enterprise/components/ProductAnalytics/MainSection/SqlQuerySection";
import { ProductAnalyticsExplorerVisualization } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ProductAnalyticsExplorerBlock";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";

function hasPreviewedSql(
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>,
): boolean {
  const dataset = block.config.dataset;
  return (
    dataset.sql.trim().length > 0 &&
    dataset.timestampColumn.length > 0 &&
    dataset.columnTypes[dataset.timestampColumn] === "date" &&
    Object.keys(dataset.columnTypes).length > 0
  );
}

export default function SqlExplorationBlockEditor({
  block,
  dashboardGlobalControls,
  target,
  headerTarget,
}: {
  block: DashboardBlockInterfaceOrData<SqlExplorationBlockInterface>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  target: HTMLDivElement;
  headerTarget: HTMLDivElement;
}) {
  const configIsReady = hasPreviewedSql(block);
  const { viewMode, setViewMode } = useSqlEditorContext();
  const [chartReady, setChartReady] = useState(configIsReady);

  useEffect(() => {
    if (!configIsReady) {
      setChartReady(false);
      setViewMode("sql");
    }
  }, [configIsReady, setViewMode]);

  const handleChartReadyChange = useCallback(
    (ready: boolean) => {
      setChartReady(ready);
      if (!ready) {
        setViewMode("sql");
      }
    },
    [setViewMode],
  );

  const chartTrigger = (
    <TabsTrigger value="chart" disabled={!chartReady}>
      Chart
    </TabsTrigger>
  );

  return createPortal(
    <Tabs
      value={viewMode}
      onValueChange={(value) => setViewMode(value === "sql" ? "sql" : "chart")}
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        width: "100%",
        flexDirection: "column",
      }}
    >
      {createPortal(
        <TabsList size="1" style={{ marginRight: "var(--space-2)" }}>
          {chartReady ? (
            chartTrigger
          ) : (
            <Tooltip
              body="Run the current SQL query successfully to view the chart."
              usePortal
            >
              <span>{chartTrigger}</span>
            </Tooltip>
          )}
          <TabsTrigger value="sql">SQL</TabsTrigger>
        </TabsList>,
        headerTarget,
      )}
      <TabsContent
        value="chart"
        forceMount
        style={{
          display: viewMode === "chart" ? "block" : "none",
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <ProductAnalyticsExplorerVisualization
          block={block}
          dashboardGlobalControls={dashboardGlobalControls}
        />
      </TabsContent>
      <TabsContent
        value="sql"
        forceMount
        style={{
          display: viewMode === "sql" ? "flex" : "none",
          flex: 1,
          minHeight: 0,
        }}
      >
        <SqlQuerySection
          fullHeight
          showHeader={false}
          onChartReadyChange={handleChartReadyChange}
          onRunSuccess={() => setViewMode("chart")}
        />
      </TabsContent>
    </Tabs>,
    target,
  );
}
