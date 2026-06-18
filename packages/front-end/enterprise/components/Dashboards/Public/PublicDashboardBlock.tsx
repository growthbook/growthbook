import { ReactElement, ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterface,
  MarkdownBlockInterface,
  SqlExplorerBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import Callout from "@/ui/Callout";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor";
import MarkdownBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/MarkdownBlock";
import SqlExplorerBlock from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/SqlExplorerBlock";
import { BlockProps } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock";

export interface PublicDashboardBlockProps {
  block: DashboardBlockInterface;
  ssrPolyfills: SSRPolyfills;
  savedQueriesMap: Map<string, SavedQuery>;
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
      ) : (
        <Callout status="info" size="sm">
          This query result isn&apos;t available.
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
