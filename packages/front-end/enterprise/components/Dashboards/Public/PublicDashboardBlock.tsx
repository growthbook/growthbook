import { ReactElement } from "react";
import {
  DashboardBlockInterface,
  MarkdownBlockInterface,
  SqlExplorerBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import Callout from "@/ui/Callout";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import MarkdownBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/MarkdownBlock";
import SqlExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/SqlExplorerBlock";
import { BlockProps } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock";

export interface PublicDashboardBlockProps {
  block: DashboardBlockInterface;
  ssrPolyfills: SSRPolyfills;
  savedQueriesMap: Map<string, SavedQuery>;
}

// Read-only renderer for a single dashboard block on the public (no-auth) page.
// Reuses the real block components but feeds them data from the public endpoint
// payload + ssrPolyfills instead of authenticated hooks/snapshot context.
//
// Scope (3a): blocks that need no authenticated data — markdown and
// sql-explorer. Experiment-result, experiment-metadata, metric-explorer, and
// exploration blocks render a placeholder until 3b/3c wire their data.
export default function PublicDashboardBlock({
  block,
  ssrPolyfills,
  savedQueriesMap,
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
  };

  switch (block.type) {
    case "markdown":
      return (
        <MarkdownBlock
          {...(baseProps as unknown as BlockProps<MarkdownBlockInterface>)}
          block={block}
        />
      );
    case "sql-explorer": {
      const savedQuery = block.savedQueryId
        ? savedQueriesMap.get(block.savedQueryId)
        : undefined;
      if (!savedQuery) {
        return (
          <Callout status="info" size="sm">
            This query result isn&apos;t available.
          </Callout>
        );
      }
      return (
        <SqlExplorerBlock
          {...(baseProps as unknown as BlockProps<SqlExplorerBlockInterface>)}
          block={block}
          savedQuery={savedQuery}
        />
      );
    }
    default:
      return (
        <Callout status="info" size="sm">
          This block type isn&apos;t available in the public view yet.
        </Callout>
      );
  }
}
