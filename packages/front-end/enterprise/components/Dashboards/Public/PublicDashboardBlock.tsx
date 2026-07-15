import { ReactElement, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterface,
  DataSourceExplorationBlockInterface,
  ExperimentDimensionBlockInterface,
  ExperimentMetricBlockInterface,
  ExperimentTimeSeriesBlockInterface,
  FactTableExplorationBlockInterface,
  getBlockSnapshotAnalysis,
  MetricExplorationBlockInterface,
  resolveExperimentBlockMetricIds,
} from "shared/enterprise";
import { ProductAnalyticsExploration, SavedQuery } from "shared/validators";
import { isDefined } from "shared/util";
import { ExperimentMetricDefinition, isFactMetric } from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor";
import MarkdownBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/MarkdownBlock";
import SqlExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/SqlExplorerBlock";
import ExperimentMetadataBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentMetadataBlock";
import ExperimentTrafficBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentTrafficBlock";
import ExperimentMetricBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentMetricBlock";
import ExperimentDimensionBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentDimensionBlock";
import ExperimentTimeSeriesBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentTimeSeriesBlock";
import MetricExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/MetricExplorerBlock";
import ProductAnalyticsExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ProductAnalyticsExplorerBlock";

export interface PublicDashboardBlockProps {
  block: DashboardBlockInterface;
  dashboardUid: string;
  ssrPolyfills: SSRPolyfills;
  savedQueriesMap: Map<string, SavedQuery>;
  snapshotsMap: Map<string, ExperimentSnapshotInterface>;
  metricAnalysesMap: Map<string, MetricAnalysisInterface>;
  explorationsMap: Map<string, ProductAnalyticsExploration>;
  blockDataLoading: boolean;
}

function getBlockTitle(block: DashboardBlockInterface): string {
  if (block.title) return block.title;
  return block.type === "markdown" ? "" : BLOCK_TYPE_INFO[block.type].name;
}

function BlockCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Flex
      direction="column"
      className="appbox dashboard-block px-4 py-3 mb-0"
      style={{ overflow: "auto", height: "100%", width: "100%" }}
    >
      {title ? (
        <h4
          style={{
            margin: 0,
            marginBottom: 8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </h4>
      ) : null}
      <Box style={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Flex>
  );
}

export default function PublicDashboardBlock({
  block,
  dashboardUid,
  ssrPolyfills,
  savedQueriesMap,
  snapshotsMap,
  metricAnalysesMap,
  explorationsMap,
  blockDataLoading,
}: PublicDashboardBlockProps): ReactElement {
  // Shared props for every block component. Snapshot/analysis are stubbed the
  // same way the authenticated DashboardBlock does; experiment-result blocks
  // override them with the resolved values below.
  const baseProps = {
    isTabActive: true,
    setBlock: undefined,
    mutate: () => {},
    isEditing: false,
    ssrPolyfills,
    hideSql: true,
    isPublic: true,
    publicShareUid: dashboardUid,
    snapshot: {} as ExperimentSnapshotInterface,
    analysis: {} as ExperimentSnapshotAnalysis,
  };

  // SSR experiments are Partial; block components read the subset of fields the
  // public endpoint provides.
  const asExperiment = (experiment: Partial<ExperimentInterfaceStringDates>) =>
    experiment as ExperimentInterfaceStringDates;

  const blockFallback = (
    message = "Results for this block aren't available.",
  ): ReactNode =>
    blockDataLoading ? (
      <LoadingSpinner />
    ) : (
      <Callout status="info" size="sm">
        {message}
      </Callout>
    );

  const resolveExperimentResult = (
    b:
      | ExperimentMetricBlockInterface
      | ExperimentDimensionBlockInterface
      | ExperimentTimeSeriesBlockInterface,
  ) => {
    const experiment = ssrPolyfills.getExperimentById(b.experimentId);
    const snapshotId = b.snapshotId || experiment?.analysisSummary?.snapshotId;
    const snapshot = snapshotId ? snapshotsMap.get(snapshotId) : undefined;
    const analysis = snapshot ? getBlockSnapshotAnalysis(snapshot, b) : null;
    const metrics = resolveExperimentBlockMetricIds({
      blockMetricIds: b.metricIds ?? [],
      experiment: experiment ?? undefined,
      metricGroups: ssrPolyfills.metricGroups,
    })
      .map((id) => ssrPolyfills.getExperimentMetricById(id))
      .filter(isDefined);
    return { experiment, snapshot, analysis, metrics };
  };

  const renderExperimentResult = (
    resolved: ReturnType<typeof resolveExperimentResult>,
    render: (r: {
      experiment: ExperimentInterfaceStringDates;
      snapshot: ExperimentSnapshotInterface;
      analysis: ExperimentSnapshotAnalysis;
      metrics: ExperimentMetricDefinition[];
    }) => ReactNode,
  ): ReactNode => {
    const { experiment, snapshot, analysis, metrics } = resolved;
    if (experiment && snapshot && analysis) {
      return render({
        experiment: asExperiment(experiment),
        snapshot,
        analysis,
        metrics,
      });
    }
    return blockFallback();
  };

  const renderExplorationBlock = (
    b:
      | MetricExplorationBlockInterface
      | FactTableExplorationBlockInterface
      | DataSourceExplorationBlockInterface,
  ): ReactNode => {
    const exploration = b.explorerAnalysisId
      ? explorationsMap.get(b.explorerAnalysisId)
      : undefined;
    const comparisonExploration = b.comparisonExplorerAnalysisId
      ? (explorationsMap.get(b.comparisonExplorerAnalysisId) ?? null)
      : null;
    if (!exploration) return blockFallback();
    return (
      <ProductAnalyticsExplorerBlock
        {...baseProps}
        block={b}
        exploration={exploration}
        comparisonExploration={comparisonExploration}
        query={null}
      />
    );
  };

  let content: ReactNode;
  switch (block.type) {
    case "markdown":
      content = <MarkdownBlock {...baseProps} block={block} />;
      break;
    case "sql-explorer": {
      const savedQuery = block.savedQueryId
        ? savedQueriesMap.get(block.savedQueryId)
        : undefined;
      content = savedQuery ? (
        <SqlExplorerBlock
          {...baseProps}
          block={block}
          savedQuery={savedQuery}
        />
      ) : (
        blockFallback("This query result isn't available.")
      );
      break;
    }
    case "experiment-metadata": {
      const experiment = ssrPolyfills.getExperimentById(block.experimentId);
      content = experiment ? (
        <ExperimentMetadataBlock
          {...baseProps}
          block={block}
          experiment={asExperiment(experiment)}
        />
      ) : (
        blockFallback("This experiment isn't available.")
      );
      break;
    }
    case "experiment-traffic": {
      const experiment = ssrPolyfills.getExperimentById(block.experimentId);
      const snapshotId =
        block.snapshotId || experiment?.analysisSummary?.snapshotId;
      const snapshot = snapshotId ? snapshotsMap.get(snapshotId) : undefined;
      const analysis = snapshot
        ? getBlockSnapshotAnalysis(snapshot, block)
        : null;
      content =
        experiment && snapshot && analysis ? (
          <ExperimentTrafficBlock
            {...baseProps}
            block={block}
            experiment={asExperiment(experiment)}
            snapshot={snapshot}
            analysis={analysis}
          />
        ) : (
          blockFallback()
        );
      break;
    }
    case "experiment-metric":
      content = renderExperimentResult(
        resolveExperimentResult(block),
        ({ experiment, snapshot, analysis, metrics }) => (
          <ExperimentMetricBlock
            {...baseProps}
            block={block}
            experiment={experiment}
            snapshot={snapshot}
            analysis={analysis}
            metrics={metrics}
          />
        ),
      );
      break;
    case "experiment-dimension":
      content = renderExperimentResult(
        resolveExperimentResult(block),
        ({ experiment, snapshot, analysis, metrics }) => (
          <ExperimentDimensionBlock
            {...baseProps}
            block={block}
            experiment={experiment}
            snapshot={snapshot}
            analysis={analysis}
            metrics={metrics}
          />
        ),
      );
      break;
    case "experiment-time-series":
      content = renderExperimentResult(
        resolveExperimentResult(block),
        ({ experiment, snapshot, analysis, metrics }) => (
          <ExperimentTimeSeriesBlock
            {...baseProps}
            block={block}
            experiment={experiment}
            snapshot={snapshot}
            analysis={analysis}
            metrics={metrics}
          />
        ),
      );
      break;
    case "metric-explorer": {
      const resolvedMetric = ssrPolyfills.getExperimentMetricById(
        block.factMetricId,
      );
      const factMetric: FactMetricInterface | undefined =
        resolvedMetric && isFactMetric(resolvedMetric)
          ? resolvedMetric
          : undefined;
      const metricAnalysis = block.metricAnalysisId
        ? metricAnalysesMap.get(block.metricAnalysisId)
        : undefined;
      content =
        factMetric && metricAnalysis ? (
          <MetricExplorerBlock
            {...baseProps}
            block={block}
            factMetric={factMetric}
            metricAnalysis={metricAnalysis}
          />
        ) : (
          blockFallback()
        );
      break;
    }
    case "metric-exploration":
    case "fact-table-exploration":
    case "data-source-exploration":
      content = renderExplorationBlock(block);
      break;
    default: {
      const _exhaustiveCheck: never = block;
      return _exhaustiveCheck;
    }
  }

  return <BlockCard title={getBlockTitle(block)}>{content}</BlockCard>;
}
