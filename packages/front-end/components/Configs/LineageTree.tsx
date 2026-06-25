import React from "react";
import { Box } from "@radix-ui/themes";
import Link from "@/ui/Link";
import { LineageNode } from "@/components/Configs/fieldSchema";

// Renders the lineage tree (base → children) recursively, highlighting the
// current config.
export default function LineageTree({
  nodes,
  parentKey,
  currentKey,
  depth = 0,
}: {
  nodes: LineageNode[];
  parentKey: string | null;
  currentKey: string;
  depth?: number;
}): React.ReactElement {
  const children = nodes.filter((n) => n.parentKey === parentKey);
  return (
    <>
      {children.map((n) => (
        <Box key={n.key}>
          <Box style={{ paddingLeft: depth * 16 }} py="1">
            <Link
              href={`/configs/${n.key}`}
              color={n.key === currentKey ? "violet" : "dark"}
              weight={n.key === currentKey ? "bold" : "regular"}
            >
              {n.name}
            </Link>
          </Box>
          <LineageTree
            nodes={nodes}
            parentKey={n.key}
            currentKey={currentKey}
            depth={depth + 1}
          />
        </Box>
      ))}
    </>
  );
}
