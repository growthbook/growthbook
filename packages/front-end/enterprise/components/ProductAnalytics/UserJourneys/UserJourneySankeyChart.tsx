import { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import type { UserJourneyPathRow } from "shared/validators";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

function pathRowsToSankeyData(rows: UserJourneyPathRow[]): {
  nodes: { name: string }[];
  links: { source: string; target: string; value: number }[];
} {
  const linkMap = new Map<string, number>();
  const nodeNames = new Set<string>();

  for (const row of rows) {
    const { steps, unit_count } = row;
    if (!steps?.length || unit_count == null) continue;
    for (let i = 0; i < steps.length - 1; i++) {
      const source = steps[i];
      const target = steps[i + 1];
      if (source == null || target == null) continue;
      nodeNames.add(source);
      nodeNames.add(target);
      const key = `${source}|${target}`;
      linkMap.set(key, (linkMap.get(key) ?? 0) + unit_count);
    }
  }

  const nodes = Array.from(nodeNames).map((name) => ({ name }));
  const links = Array.from(linkMap.entries()).map(([key, value]) => {
    const [source, target] = key.split("|");
    return { source, target, value };
  });

  return { nodes, links };
}

export default function UserJourneySankeyChart({
  rows,
}: {
  rows: UserJourneyPathRow[];
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";

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
        formatter: (params: { data: { value?: number }; value?: number }) => {
          const value = params.data?.value ?? params.value ?? 0;
          const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
          return `${value.toLocaleString()} (${pct}%)`;
        },
      },
      series: [
        {
          type: "sankey",
          data: nodes,
          links,
          focusNodeAdjacency: true,
          lineStyle: { color: "gradient", curveness: 0.5 },
          label: { color: textColor },
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
        },
      ],
    };
  }, [rows, textColor, tooltipBackgroundColor]);

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
        style={{ width: "100%", height: "100%", minHeight: 400 }}
      />
    </Box>
  );
}
