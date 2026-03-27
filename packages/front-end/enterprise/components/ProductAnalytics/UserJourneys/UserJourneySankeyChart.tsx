import { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type { UserJourneyPathRow } from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

type SankeyNodeData = {
  id: string;
  name: string;
  displayLabel: string;
  stepIndex: number;
  pathToNode: string[];
  value: number;
  itemStyle?: {
    color?: string;
  };
};

type SankeyLinkData = {
  source: string;
  target: string;
  value: number;
  sourceLabel: string;
  targetLabel: string;
};

type SankeyEventParams = {
  dataType?: string;
  data?: unknown;
};

type SankeyTooltipParams = {
  dataType?: string;
  data?: {
    value?: number;
    displayLabel?: string;
    sourceLabel?: string;
    targetLabel?: string;
  };
  value?: number;
  name?: string;
};

type SankeyLabelParams = {
  data?: SankeyNodeData;
};

type SankeyRichLabelStyle = {
  color?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  padding?: number;
};

type SankeyLabelRich = {
  label: SankeyRichLabelStyle;
  cta?: SankeyRichLabelStyle;
};

function getNodeId(stepIndex: number, pathToNode: string[]): string {
  const encodedPath = pathToNode.map((s) => encodeURIComponent(s)).join("~");
  return `${stepIndex}|${encodedPath}`;
}

function isSankeyNodeData(data: unknown): data is SankeyNodeData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<SankeyNodeData>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.displayLabel === "string" &&
    typeof candidate.stepIndex === "number" &&
    Array.isArray(candidate.pathToNode) &&
    candidate.pathToNode.every((v) => typeof v === "string")
  );
}

function pathRowsToSankeyData(rows: UserJourneyPathRow[]): {
  nodes: SankeyNodeData[];
  links: SankeyLinkData[];
} {
  const linkMap = new Map<string, SankeyLinkData>();
  const nodeMap = new Map<string, SankeyNodeData>();

  for (const row of rows) {
    const { steps, unit_count } = row;
    if (!steps?.length || unit_count == null) continue;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step == null) continue;

      const pathToNode = steps.slice(0, i + 1);
      const nodeId = getNodeId(i, pathToNode);
      const existingNode = nodeMap.get(nodeId);
      if (existingNode) {
        existingNode.value += unit_count;
      } else {
        nodeMap.set(nodeId, {
          id: nodeId,
          name: nodeId,
          displayLabel: step,
          stepIndex: i,
          pathToNode,
          value: unit_count,
        });
      }
    }

    for (let i = 0; i < steps.length - 1; i++) {
      const source = steps[i];
      const target = steps[i + 1];
      if (source == null || target == null) continue;

      const sourcePath = steps.slice(0, i + 1);
      const targetPath = steps.slice(0, i + 2);
      const sourceId = getNodeId(i, sourcePath);
      const targetId = getNodeId(i + 1, targetPath);
      const key = `${sourceId}|${targetId}`;

      const existingLink = linkMap.get(key);
      if (existingLink) {
        existingLink.value += unit_count;
      } else {
        linkMap.set(key, {
          source: sourceId,
          target: targetId,
          value: unit_count,
          sourceLabel: source,
          targetLabel: target,
        });
      }
    }
  }

  const nodes = Array.from(nodeMap.values());
  const links = Array.from(linkMap.values());

  return { nodes, links };
}

function isExtendableLeaf(
  node: SankeyNodeData | undefined,
  sourceNodeIds: Set<string>,
): boolean {
  if (!node) return false;
  return !sourceNodeIds.has(node.id) && node.displayLabel !== "(Other)";
}

function getNodeLabelText(
  node: SankeyNodeData | undefined,
  sourceNodeIds: Set<string>,
  showCta: boolean,
): string {
  if (!node) return "";
  if (!isExtendableLeaf(node, sourceNodeIds)) {
    return node.displayLabel;
  }
  if (showCta) {
    return `{label|${node.displayLabel}}  {cta|+}`;
  }
  return `{label|${node.displayLabel}}`;
}

export default function UserJourneySankeyChart({
  rows,
  onExtendPath,
  extending = false,
}: {
  rows: UserJourneyPathRow[];
  onExtendPath: (pathToExtend: string[], stepToExtend: number) => Promise<void>;
  extending?: boolean;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const ctaTextColor = theme === "dark" ? "#C4B5FD" : "#6D28D9";
  const ctaBackgroundColor =
    theme === "dark" ? "rgba(124, 58, 237, 0.35)" : "rgba(139, 92, 246, 0.18)";
  const defaultNodeColor = theme === "dark" ? "#8B5CF6" : "#7C3AED";
  const otherNodeColor = theme === "dark" ? "#6B7280" : "#9CA3AF";
  const ctaRichStyle: SankeyRichLabelStyle = useMemo(
    () => ({
      color: ctaTextColor,
      backgroundColor: ctaBackgroundColor,
      borderWidth: 1,
      borderRadius: 10,
      fontSize: 14,
      padding: 10,
    }),
    [ctaTextColor, ctaBackgroundColor],
  );

  const { option, leafNodeIds } = useMemo(() => {
    const { nodes, links } = pathRowsToSankeyData(rows);
    if (nodes.length === 0 || links.length === 0) {
      return { option: null, leafNodeIds: new Set<string>() };
    }
    const coloredNodes: SankeyNodeData[] = nodes.map((node) => ({
      ...node,
      itemStyle: {
        color:
          node.displayLabel === "(Other)" ? otherNodeColor : defaultNodeColor,
      },
    }));

    const sourceNodeIds = new Set(links.map((link) => link.source));
    const computedLeafNodeIds = new Set(
      coloredNodes
        .filter(
          (node) =>
            !sourceNodeIds.has(node.id) && node.displayLabel !== "(Other)",
        )
        .map((node) => node.id),
    );
    const labelRich: SankeyLabelRich = {
      label: { color: textColor },
    };
    const emphasisRich: SankeyLabelRich = {
      label: { color: textColor },
      cta: ctaRichStyle,
    };

    const total = links.reduce((sum, l) => sum + l.value, 0);
    const builtOption = {
      tooltip: {
        trigger: "item",
        backgroundColor: tooltipBackgroundColor,
        formatter: (params: SankeyTooltipParams) => {
          const value = params.data?.value ?? params.value ?? 0;
          const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
          if (params.dataType === "edge") {
            const sourceLabel = params.data?.sourceLabel ?? "Source";
            const targetLabel = params.data?.targetLabel ?? "Target";
            return `${sourceLabel} → ${targetLabel}<br/>${value.toLocaleString()} (${pct}%)`;
          }
          const label = params.data?.displayLabel ?? params.name ?? "";
          return `${label}<br/>${value.toLocaleString()} (${pct}%)`;
        },
      },
      series: [
        {
          type: "sankey",
          data: coloredNodes,
          links,
          focusNodeAdjacency: true,
          draggable: false,
          nodeGap: 16,
          lineStyle: { color: "target" },
          label: {
            color: textColor,
            formatter: (params: SankeyLabelParams) =>
              getNodeLabelText(params.data, sourceNodeIds, false),
            rich: labelRich,
          },
          emphasis: {
            focus: "adjacency",
            label: {
              formatter: (params: SankeyLabelParams) =>
                getNodeLabelText(params.data, sourceNodeIds, true),
              rich: emphasisRich,
            },
          },
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
          nodeAlign: "left",
        },
      ],
    };
    return { option: builtOption, leafNodeIds: computedLeafNodeIds };
  }, [
    rows,
    textColor,
    tooltipBackgroundColor,
    ctaRichStyle,
    defaultNodeColor,
    otherNodeColor,
  ]);

  const onEvents = useMemo(
    () => ({
      click: async (params: SankeyEventParams) => {
        if (params.dataType !== "node" || !isSankeyNodeData(params.data)) {
          return;
        }
        if (extending) return;
        if (!leafNodeIds.has(params.data.id)) return;

        await onExtendPath(params.data.pathToNode, params.data.stepIndex);
      },
    }),
    [extending, onExtendPath, leafNodeIds],
  );

  if (!option) {
    return (
      <Box
        style={{
          flex: 1,
          minHeight: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-mid)",
        }}
      >
        No paths to display.
      </Box>
    );
  }

  return (
    <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <EChartsReact
        option={option}
        onEvents={onEvents}
        style={{ width: "100%", height: "100%", minHeight: 400 }}
      />
    </Box>
  );
}
