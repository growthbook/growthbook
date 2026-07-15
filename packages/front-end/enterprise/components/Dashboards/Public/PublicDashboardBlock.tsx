import { ReactElement, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterface,
  DataSourceExplorationBlockInterface,
  ExperimentDimensionBlockInterface,
  ExperimentMetadataBlockInterface,
  ExperimentMetricBlockInterface,
  ExperimentTimeSeriesBlockInterface,
  ExperimentTrafficBlockInterface,
  FactTableExplorationBlockInterface,
  getBlockSnapshotAnalysis,
  MarkdownBlockInterface,
  MetricExplorationBlockInterface,
  MetricExplorerBlockInterface,
  resolveExperimentBlockMetricIds,
  SqlExplorerBlockInterface,
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
import { BlockProps } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock";

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
  const baseProps = {
    isTabActive: true,
    setBlock: undefined,
    mutate: () => {},
    isEditing: false,
    ssrPolyfills,
    hideSql: true,
    isPublic: true,
    publicShareUid: dashboardUid,
  };

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
        experiment: experiment as unknown as ExperimentInterfaceStringDates,
        snapshot,
        analysis,
        metrics,
      });
    }
    return blockDataLoading ? (
      <LoadingSpinner />
    ) : (
      <Callout status="info" size="sm">
        Results for this block aren&apos;t available.
      </Callout>
    );
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
    if (exploration) {
      return (
        <ProductAnalyticsExplorerBlock
          {...(baseProps as unknown as BlockProps<typeof b>)}
          block={b}
          exploration={exploration}
          query={null}
        />
      );
    }
    return blockDataLoading ? (
      <LoadingSpinner />
    ) : (
      <Callout status="info" size="sm">
        Results for this block aren&apos;t available.
      </Callout>
    );
  };

  let content: ReactNode;
  switch (block.type) {
    case "markdown":
      content = (
        <MarkdownBlock
          {...(baseProps as unknown as BlockProps<MarkdownBlockInterface>)}
          block={block}
        />
      );
      break;
    case "sql-explorer": {
      const savedQuery = block.savedQueryId
        ? savedQueriesMap.get(block.savedQueryId)
        : undefined;
      content = savedQuery ? (
        <SqlExplorerBlock
          {...(baseProps as unknown as BlockProps<SqlExplorerBlockInterface>)}
          block={block}
          savedQuery={savedQuery}
        />
      ) : blockDataLoading ? (
        <LoadingSpinner />
      ) : (
        <Callout status="info" size="sm">
          This query result isn&apos;t available.
        </Callout>
      );
      break;
    }
    case "experiment-metadata": {
      const experiment = ssrPolyfills.getExperimentById(block.experimentId);
      content = experiment ? (
        <ExperimentMetadataBlock
          {...(baseProps as unknown as BlockProps<ExperimentMetadataBlockInterface>)}
          block={block}
          experiment={experiment as unknown as ExperimentInterfaceStringDates}
        />
      ) : (
        <Callout status="info" size="sm">
          This experiment isn&apos;t available.
        </Callout>
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
            {...(baseProps as unknown as BlockProps<ExperimentTrafficBlockInterface>)}
            block={block}
            experiment={experiment as unknown as ExperimentInterfaceStringDates}
            snapshot={snapshot}
            analysis={analysis}
          />
        ) : blockDataLoading ? (
          <LoadingSpinner />
        ) : (
          <Callout status="info" size="sm">
            Results for this block aren&apos;t available.
          </Callout>
        );
      break;
    }
    case "experiment-metric":
      content = renderExperimentResult(
        resolveExperimentResult(block),
        ({ experiment, snapshot, analysis, metrics }) => (
          <ExperimentMetricBlock
            {...(baseProps as unknown as BlockProps<ExperimentMetricBlockInterface>)}
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
            {...(baseProps as unknown as BlockProps<ExperimentDimensionBlockInterface>)}
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
            {...(baseProps as unknown as BlockProps<ExperimentTimeSeriesBlockInterface>)}
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
            {...(baseProps as unknown as BlockProps<MetricExplorerBlockInterface>)}
            block={block}
            factMetric={factMetric}
            metricAnalysis={metricAnalysis}
          />
        ) : blockDataLoading ? (
          <LoadingSpinner />
        ) : (
          <Callout status="info" size="sm">
            Results for this block aren&apos;t available.
          </Callout>
        );
      break;
    }
    case "metric-exploration":
    case "fact-table-exploration":
    case "data-source-exploration":
      content = renderExplorationBlock(block);
      break;
    default:
      content = (
        <Callout status="info" size="sm">
          This block type isn&apos;t available in the public view yet.
        </Callout>
      );
  }

  return <BlockCard title={getBlockTitle(block)}>{content}</BlockCard>;
}
