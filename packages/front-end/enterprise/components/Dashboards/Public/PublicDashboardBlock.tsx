import { ReactElement, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterface,
  ExperimentMetadataBlockInterface,
  ExperimentTrafficBlockInterface,
  getBlockSnapshotAnalysis,
  MarkdownBlockInterface,
  SqlExplorerBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor";
import MarkdownBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/MarkdownBlock";
import SqlExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/SqlExplorerBlock";
import ExperimentMetadataBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentMetadataBlock";
import ExperimentTrafficBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ExperimentTrafficBlock";
import { BlockProps } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock";

export interface PublicDashboardBlockProps {
  block: DashboardBlockInterface;
  ssrPolyfills: SSRPolyfills;
  savedQueriesMap: Map<string, SavedQuery>;
  snapshotsMap: Map<string, ExperimentSnapshotInterface>;
  // Block result data is lazy-loaded client-side; true while it's in flight so
  // data-dependent blocks show a spinner instead of a "not available" message.
  blockDataLoading: boolean;
}

// Mirrors the authenticated dispatcher's default title (empty for markdown).
function getBlockTitle(block: DashboardBlockInterface): string {
  if (block.title) return block.title;
  return block.type === "markdown" ? "" : BLOCK_TYPE_INFO[block.type].name;
}

// The card chrome the authenticated dispatcher renders around every block
// (appbox + title header). Without it, public blocks lose their name/styling.
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

// Read-only renderer for a single dashboard block on the public (no-auth) page.
// Reuses the real block components but feeds them data from the public endpoint
// payload + ssrPolyfills instead of authenticated hooks/snapshot context.
//
// Supported: markdown, sql-explorer, experiment-metadata, experiment-traffic.
// The metric-bearing experiment blocks (experiment-metric / -dimension /
// -time-series), metric-explorer, and exploration blocks render a placeholder
// until their data + metric resolution are wired.
export default function PublicDashboardBlock({
  block,
  ssrPolyfills,
  savedQueriesMap,
  snapshotsMap,
  blockDataLoading,
}: PublicDashboardBlockProps): ReactElement {
  // Props every block component declares. The no-auth blocks ignore the
  // result-data fields (snapshot/analysis) and the edit callbacks, so passing
  // stubs is safe; the cast mirrors the authenticated dispatcher.
  const baseProps = {
    isTabActive: true,
    setBlock: undefined,
    mutate: () => {},
    isEditing: false,
    ssrPolyfills,
    // Public view: SQL is stripped server-side, so hide the SQL tab.
    hideSql: true,
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
      // Fall back to the experiment's default snapshot when the block has no
      // per-block snapshotId (mirrors the authenticated useDashboardSnapshot).
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
            experiment={
              experiment as unknown as ExperimentInterfaceStringDates
            }
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
    default:
      content = (
        <Callout status="info" size="sm">
          This block type isn&apos;t available in the public view yet.
        </Callout>
      );
  }

  return <BlockCard title={getBlockTitle(block)}>{content}</BlockCard>;
}
