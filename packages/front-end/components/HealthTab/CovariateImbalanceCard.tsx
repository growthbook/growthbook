import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useEffect, useState } from "react";
import { CovariateImbalanceResult } from "shared/health";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCaretDown, PiCaretRight } from "react-icons/pi";
import { CovariateImbalanceMetricVariationTable } from "@/components/Experiment/TabbedPage/CovariateImbalanceTable";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  covariateImbalanceResult: CovariateImbalanceResult | null;
  variations: ExperimentReportVariation[];
  snapshot: ExperimentSnapshotInterface;
  onNotify?: (issue: IssueValue) => void;
}

export default function CovariateImbalanceCard({
  covariateImbalanceResult,
  variations,
  snapshot,
  onNotify,
}: Props) {
  const covariateImbalanceHealth = covariateImbalanceResult?.isImbalanced
    ? "unhealthy"
    : "healthy";
  const [isCollapsed, setIsCollapsed] = useState(true);
  useEffect(() => {
    if (covariateImbalanceHealth === "unhealthy" && onNotify) {
      onNotify({
        label: "Pre-Exposure Bias",
        value: "covariateBalanceCheck",
      });
    }
  }, [covariateImbalanceHealth, onNotify]);

  const numMetricsTested =
    (covariateImbalanceResult?.numGoalMetrics ?? 0) +
    (covariateImbalanceResult?.numGuardrailMetrics ?? 0);

  // Check if CUPED is enabled for the experiment or any of the metrics
  const cupedEnabled =
    snapshot.settings.regressionAdjustmentEnabled ||
    snapshot.settings.metricSettings.some(
      (m) => m.computedSettings?.regressionAdjustmentEnabled,
    );

  return (
    <Box className="appbox" p="4" my="4">
      <Box>
        <Flex justify="between" align="center">
          <Heading as="h2" size="large">
            Pre-Exposure Bias Check
          </Heading>
          <Box>
            {/* collapsible toggle */}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsCollapsed((prev) => !prev)}
            >
              {isCollapsed ? (
                <PiCaretRight size={15} />
              ) : (
                <PiCaretDown size={15} />
              )}
            </Button>
          </Box>
        </Flex>
        {covariateImbalanceHealth !== "healthy" && (
          <StatusBadge status={covariateImbalanceHealth} />
        )}
        <Text as="p" mt="1">
          Detects differences in pre-exposure control vs treatment means
        </Text>
        <Separator size="4" my="3" />
        <Box pt="2">
          {!cupedEnabled ? (
            <Box mt="2">
              <Text color="text-low">Only available with CUPED enabled.</Text>
            </Box>
          ) : numMetricsTested === 0 ? (
            <Box mt="2">
              <Text color="text-low">No metrics have been added.</Text>
            </Box>
          ) : covariateImbalanceHealth === "healthy" ? (
            <Callout status="success">
              <Text weight="semibold">
                {numMetricsTested} metric{numMetricsTested > 1 ? "s" : ""} show
                {numMetricsTested > 1 ? "" : "s"} no covariate imbalance.{" "}
                <Link
                  href="https://docs.growthbook.io/statistics/pre-exposure-bias"
                  target="_blank"
                >
                  Learn more
                </Link>
                <Box display="inline-block" ml="1">
                  <PiArrowSquareOut size={15} />
                </Box>
              </Text>
            </Callout>
          ) : (
            <Callout status="warning">
              <Text weight="semibold">
                {numMetricsTested} goal or guardrail metric
                {numMetricsTested > 1 ? "s" : ""} show
                {numMetricsTested > 1 ? "" : "s"} show pre-exposure imbalance
                (significance level 0.02).
              </Text>
            </Callout>
          )}
        </Box>
        {!isCollapsed && (
          <Box className="row justify-content-start w-100 overflow-auto">
            <CovariateImbalanceMetricVariationTable
              covariateImbalanceResult={covariateImbalanceResult}
              variations={variations}
              goalMetricIds={snapshot.settings.goalMetrics}
              secondaryMetricIds={snapshot.settings.secondaryMetrics}
              guardrailMetricIds={snapshot.settings.guardrailMetrics}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
