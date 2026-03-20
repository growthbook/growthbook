import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type { UserJourneyPathRow } from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { PopoverContent } from "@/ui/Popover";
import Button from "@/ui/Button";

type SankeyNodeData = {
  id: string;
  name: string;
  displayLabel: string;
  stepIndex: number;
  pathToNode: string[];
  value: number;
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
  event?: {
    offsetX?: number;
    offsetY?: number;
    event?: {
      offsetX?: number;
      offsetY?: number;
    };
  };
};

type SelectedNodeState = {
  node: SankeyNodeData;
  x: number;
  y: number;
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

function getEventOffset(
  params: SankeyEventParams,
): { x: number; y: number } | null {
  const rootEvent = params.event;
  if (!rootEvent) return null;
  const nestedEvent = rootEvent.event;
  const offsetX = nestedEvent?.offsetX ?? rootEvent.offsetX;
  const offsetY = nestedEvent?.offsetY ?? rootEvent.offsetY;
  if (typeof offsetX !== "number" || typeof offsetY !== "number") return null;
  return { x: offsetX, y: offsetY };
}

function pathRowsToSankeyData(rows: UserJourneyPathRow[]): {
  nodes: SankeyNodeData[];
  links: SankeyLinkData[];
} {
  const linkMap = new Map<string, SankeyLinkData>();
  const nodeMap = new Map<string, SankeyNodeData>();

  console.log("raw rows", rows);

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
  console.log("nodes", nodes);
  console.log("links", links);

  return { nodes, links };
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
  const [selectedNode, setSelectedNode] = useState<SelectedNodeState | null>(
    null,
  );
  const popoverRef = useRef<HTMLDivElement>(null);

  const option = useMemo(() => {
    const { nodes, links } = pathRowsToSankeyData(rows);
    if (nodes.length === 0 || links.length === 0) {
      return null;
    }
    const total = links.reduce((sum, l) => sum + l.value, 0);
    return {
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
          data: nodes,
          links,
          focusNodeAdjacency: true,
          draggable: false,
          lineStyle: { color: "gradient", curveness: 0.5 },
          label: {
            color: textColor,
            formatter: (params: { data?: SankeyNodeData }) =>
              params.data?.displayLabel ?? "",
          },
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
          emphasis: { focus: "adjacency" },
          nodeAlign: "left",
        },
      ],
    };
  }, [rows, textColor, tooltipBackgroundColor]);

  const onEvents = useMemo(
    () => ({
      click: (params: SankeyEventParams) => {
        if (params.dataType !== "node" || !isSankeyNodeData(params.data)) {
          return;
        }
        const offset = getEventOffset(params);
        if (!offset) return;
        setSelectedNode({ node: params.data, x: offset.x, y: offset.y });
      },
      // globalout: () => setSelectedNode(null),
    }),
    [],
  );

  const handleExtendPath = useCallback(async () => {
    if (!selectedNode || extending) return;
    await onExtendPath(
      selectedNode.node.pathToNode,
      selectedNode.node.stepIndex,
    );
    setSelectedNode(null);
  }, [extending, selectedNode, onExtendPath]);

  useEffect(() => {
    if (!selectedNode) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      const target = event.target as Node | null;
      if (target && popoverRef.current.contains(target)) return;
      setSelectedNode(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedNode(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedNode]);

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
      {selectedNode && (
        <Box
          style={{
            position: "absolute",
            left: selectedNode.x,
            top: selectedNode.y,
            transform: "translate(-50%, -100%)",
            zIndex: 10,
          }}
        >
          <PopoverContent ref={popoverRef}>
            <Box m="4">
              <Flex direction="column" gap="2" style={{ minWidth: "180px" }}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={extending}
                  onClick={handleExtendPath}
                >
                  Extend this Path
                </Button>
              </Flex>
            </Box>
          </PopoverContent>
        </Box>
      )}
      <EChartsReact
        option={option}
        onEvents={onEvents}
        style={{ width: "100%", height: "100%", minHeight: 400 }}
      />
    </Box>
  );
}
