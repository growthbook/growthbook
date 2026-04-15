import React, { useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { PiSparkle } from "react-icons/pi";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { encodeExplorationConfig } from "shared/enterprise";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import { AssistantBubble } from "@/enterprise/components/AIChat/AIChatPrimitives";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import SimpleExplorationTable from "@/enterprise/components/ProductAnalytics/MainSection/SimpleExplorationTable";
import SaveToDashboardModal from "@/enterprise/components/ProductAnalytics/SaveToDashboardModal";

export interface ChartData {
  config: ExplorationConfig;
  exploration: ProductAnalyticsExploration | null;
}

const TABLE_CHART_TYPES: readonly string[] = ["table", "timeseries-table"];

const EXPLORER_PATHS: Record<ExplorationConfig["type"], string> = {
  metric: "/product-analytics/explore/metrics",
  fact_table: "/product-analytics/explore/fact-table",
  data_source: "/product-analytics/explore/data-source",
};

export function chartDataFromToolResult(result: unknown): ChartData | null {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return chartDataFromRecord(parsed as Record<string, unknown>);
      }
    } catch {
      return null;
    }
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  return chartDataFromRecord(result as Record<string, unknown>);
}

export function chartDataFromRecord(
  data: Record<string, unknown>,
): ChartData | null {
  const exploration =
    (data.exploration as ProductAnalyticsExploration | null) ?? null;
  let config = data.config as ExplorationConfig | undefined;
  if ((!config || typeof config !== "object") && exploration?.config) {
    config = exploration.config as ExplorationConfig;
  }
  if (!config || typeof config !== "object") return null;
  return { config, exploration };
}

interface ExplorationBubbleProps {
  chartData: ChartData;
  toolTransparency?: React.ReactNode;
  animate?: boolean;
}

export default function ExplorationBubble({
  chartData,
  toolTransparency,
  animate = true,
}: ExplorationBubbleProps) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const explorerUrl = `${EXPLORER_PATHS[chartData.config.type]}?config=${encodeExplorationConfig(chartData.config)}`;
  const isTable = TABLE_CHART_TYPES.includes(chartData.config.chartType);

  return (
    <AssistantBubble wide>
      {showSaveModal && (
        <SaveToDashboardModal
          close={() => setShowSaveModal(false)}
          config={chartData.config}
          exploration={chartData.exploration}
        />
      )}
      <Flex align="center" gap="2" mb="2">
        <PiSparkle size={12} />
        <Text size="small" weight="medium">
          {isTable ? "Generated table" : "Generated chart"}
        </Text>
        <Flex ml="auto" gap="1">
          <Button
            variant="ghost"
            size="xs"
            color="violet"
            onClick={() => setShowSaveModal(true)}
          >
            Save to Dashboard
          </Button>
          <LinkButton
            href={explorerUrl}
            variant="ghost"
            size="xs"
            color="violet"
          >
            Open in Explorer
          </LinkButton>
        </Flex>
      </Flex>
      {isTable ? (
        <SimpleExplorationTable
          exploration={chartData.exploration}
          config={chartData.config}
        />
      ) : (
        <Flex style={{ height: 360, minHeight: 260 }}>
          <ExplorerChart
            exploration={chartData.exploration}
            error={chartData.exploration?.error ?? null}
            submittedExploreState={chartData.config}
            loading={false}
            animate={animate}
          />
        </Flex>
      )}
      {toolTransparency ? (
        <Box mt="2" pt="2" style={{ borderTop: "1px solid var(--gray-a5)" }}>
          {toolTransparency}
        </Box>
      ) : null}
    </AssistantBubble>
  );
}
