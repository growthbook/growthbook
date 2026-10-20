import { ReactElement } from "react";
import { DashboardBlockType } from "shared/enterprise";
import {
  PiArticleMediumDuotone,
  PiChartBar,
  PiChartBarDuotone,
  PiChartLineDuotone,
  PiDatabase,
  PiFileSqlDuotone,
  PiFunnel,
  PiGaugeDuotone,
  PiListDashesDuotone,
  PiTable,
  PiTableDuotone,
} from "react-icons/pi";

type BlockTypeInfo = {
  name: string;
  icon: ReactElement;
  description?: string;
  deprecated?: boolean;
};

export const BLOCK_TYPE_INFO: Record<DashboardBlockType, BlockTypeInfo> = {
  markdown: {
    name: "Markdown",
    icon: <PiArticleMediumDuotone />,
    description: "Adds formatted text, links, and images to your dashboard.",
  },
  "experiment-metadata": {
    name: "Experiment Metadata",
    icon: <PiListDashesDuotone />,
  },
  "experiment-metric": {
    name: "Metric Results",
    icon: <PiTableDuotone />,
  },
  "metric-experiments": {
    name: "Experiments with Lift",
    icon: <PiTableDuotone />,
    description: "Shows experiments with lift for a selected metric.",
  },
  "experiments-scaled-impact": {
    name: "Scaled Impact",
    icon: <PiChartLineDuotone />,
    description:
      "Shows the scaled impact of a metric across multiple experiments.",
  },
  "experiments-win-rate": {
    name: "Win Percentage",
    icon: <PiGaugeDuotone />,
    description:
      "Shows the win percentage for selected experiments, optionally filtered by project.",
  },
  "experiments-status": {
    name: "Team Velocity",
    icon: <PiChartBarDuotone />,
    description:
      "Shows number of experiments in each status (won, lost, inconclusive, and dnf) over a selected date range.",
  },
  "experiment-dimension": {
    name: "Dimension Results",
    icon: <PiTableDuotone />,
  },
  "experiment-time-series": {
    name: "Time Series",
    icon: <PiChartLineDuotone />,
  },
  "experiment-traffic": {
    name: "Experiment Traffic",
    icon: <PiChartLineDuotone />,
  },
  "sql-explorer": {
    name: "Custom SQL Query",
    icon: <PiFileSqlDuotone />,
    deprecated: true,
    description:
      "Displays results and saved visualizations from a custom SQL query.",
  },
  "metric-explorer": {
    name: "Metric",
    icon: <PiFileSqlDuotone />,
    description: "Shows an analysis of a single Fact Metric.",
    deprecated: true,
  },
  "metric-exploration": {
    name: "Metric Explorer",
    icon: <PiChartBar />,
    description:
      "Charts one or more of your existing GrowthBook Metrics over a selected date range. View trends, compare time periods, and slice/dice your data.",
  },
  "fact-table-exploration": {
    name: "Fact Table Explorer",
    icon: <PiTable />,
    description:
      "Builds an analysis directly from events and columns in one of your existing Fact Tables.",
  },
  "data-source-exploration": {
    name: "Data Source Explorer",
    icon: <PiDatabase />,
    description:
      "Builds a custom analysis from tables and columns from one of your connected Data Sources.",
  },
  "sql-exploration": {
    name: "SQL Explorer",
    icon: <PiFileSqlDuotone />,
    description: "Build a visualization from a custom SQL query.",
  },
  "funnel-exploration": {
    name: "Funnel Explorer",
    icon: <PiFunnel />,
    description:
      "Builds a custom funnel from events and columns from one of your existing Fact Tables.",
  },
};

export const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  [
    "Metric Results",
    ["experiment-metric", "experiment-dimension", "experiment-time-series"],
  ],
  ["Experiment Info", ["experiment-metadata", "experiment-traffic"]],
  [
    "Product Analytics",
    [
      "metric-exploration",
      "fact-table-exploration",
      "data-source-exploration",
      "funnel-exploration",
      "sql-exploration",
    ],
  ],
  [
    "Experimentation",
    [
      "experiments-status",
      "experiments-win-rate",
      "metric-experiments",
      "experiments-scaled-impact",
    ],
  ],
  ["Other", ["sql-explorer", "markdown", "metric-explorer"]],
];

export const GENERAL_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "sql-explorer",
  "metric-explorer",
  "metric-exploration",
  "fact-table-exploration",
  "data-source-exploration",
  "sql-exploration",
  "funnel-exploration",
  "metric-experiments",
  "experiments-scaled-impact",
  "experiments-win-rate",
  "experiments-status",
  "markdown",
];

export const isBlockTypeAllowed = (
  blockType: DashboardBlockType,
  isGeneralDashboard: boolean,
): boolean =>
  !isGeneralDashboard || GENERAL_DASHBOARD_BLOCK_TYPES.includes(blockType);

export function getAvailableBlockTypes(
  isGeneralDashboard: boolean,
): DashboardBlockType[] {
  return BLOCK_SUBGROUPS.flatMap(([, blockTypes]) =>
    blockTypes.filter(
      (blockType) =>
        isBlockTypeAllowed(blockType, isGeneralDashboard) &&
        !BLOCK_TYPE_INFO[blockType].deprecated,
    ),
  );
}
