import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useEffect, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCaretDown, PiCaretRight } from "react-icons/pi";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { expandMetricGroups } from "shared/experiments";
import CovariateImbalanceTable from "@/components/Experiment/TabbedPage/CovariateImbalanceTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  variations: ExperimentReportVariation[];
  snapshot: ExperimentSnapshotInterface;
  onNotify?: (issue: IssueValue) => void;
}

export default function CovariateImbalanceCard({
  experiment,
  variations,
  snapshot,
  onNotify,
}: Props) {
  const { metricGroups } = useDefinitions();
  const covariateImbalanceResult = snapshot?.health?.covariateImbalance;

  const isImbalanced = covariateImbalanceResult?.isImbalanced ?? false;

  const [isCollapsed, setIsCollapsed] = useState(isImbalanced ? false : true);

  const metricSettingsById = new Map(
    snapshot.settings.metricSettings.map((m) => [m.id, m]),
  );

  const shouldIncludeMetricInCovariateImbalance = (metricId: string) => {
    const metricForSnapshot = metricSettingsById.get(metricId);
    // If the metric isn't in the snapshot (e.g. added after last run), keep it
    // so the table can show "No data".
    if (!metricForSnapshot) return true;
    // If the snapshot doesn't have computed settings, keep it (backwards compat).
    if (!metricForSnapshot.computedSettings) return true;
    // Only hide metrics where the snapshot explicitly says CUPED is disabled.
    return !!metricForSnapshot.computedSettings.regressionAdjustmentEnabled;
  };

  const goalMetricIds = Array.from(
    new Set(
      expandMetricGroups(experiment.goalMetrics, metricGroups).filter(
        shouldIncludeMetricInCovariateImbalance,
      ),
    ),
  );
  const secondaryMetricIds = Array.from(
    new Set(
      expandMetricGroups(experiment.secondaryMetrics, metricGroups).filter(
        shouldIncludeMetricInCovariateImbalance,
      ),
    ),
  );
  const guardrailMetricIds = Array.from(
    new Set(
      expandMetricGroups(experiment.guardrailMetrics, metricGroups).filter(
        shouldIncludeMetricInCovariateImbalance,
      ),
    ),
  );

  useEffect(() => {
    setIsCollapsed(!isImbalanced);
  }, [isImbalanced]);

  useEffect(() => {
    if (isImbalanced && onNotify) {
      onNotify({
        label: "Pre-Exposure Bias",
        value: "covariateBalanceCheck",
      });
    }
  }, [isImbalanced, onNotify, covariateImbalanceResult]);

  const goalAndGuardrailMetricsTested =
    (covariateImbalanceResult?.numGoalMetrics ?? 0) +
    (covariateImbalanceResult?.numGuardrailMetrics ?? 0);

  const goalAndGuardrailMetricsImbalanced =
    (covariateImbalanceResult?.numGoalMetricsImbalanced ?? 0) +
    (covariateImbalanceResult?.numGuardrailMetricsImbalanced ?? 0);

  const totalNumMetricsTested =
    goalAndGuardrailMetricsTested +
    (covariateImbalanceResult?.numSecondaryMetrics ?? 0);
  const experimentHasMetrics =
    goalMetricIds.length +
      secondaryMetricIds.length +
      guardrailMetricIds.length >
    0;

  // Match packages/shared/src/health/covariate-imbalance.ts: per-metric flags use
  // Bonferroni alpha_family / nTests (only goal + guardrail metrics count toward nTests).
  const numVariations = variations.length;
  const numBonferroniTests = Math.max(
    1,
    (numVariations - 1) *
      ((snapshot.settings.goalMetrics?.length ?? 0) +
        (snapshot.settings.guardrailMetrics?.length ?? 0)),
  );

  // Check if CUPED is enabled for the experiment
  const cupedEnabled = snapshot.settings.regressionAdjustmentEnabled;

  return (
    <Box className="appbox" p="4" my="4">
      <Box mb="2">
        <Flex justify="between" align="center">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading as="h2" size="large" mb="0">
              Pre-Exposure Bias Check
            </Heading>
            {isImbalanced && <StatusBadge status="unhealthy" />}
          </Flex>
          <Box>
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
        <Text as="p" mt="1">
          Detects differences in pre-exposure baseline and variation means
        </Text>
        <Separator size="4" my="3" />
        <Box pt="2">
          {!cupedEnabled ? (
            <Box mt="2">
              <Text color="text-low">
                <i>Only available with CUPED enabled.</i>
              </Text>
            </Box>
          ) : totalNumMetricsTested === 0 ? (
            <Box mt="2">
              <Text color="text-low">
                <i>
                  {experimentHasMetrics
                    ? "No pre-exposure checks found in results."
                    : "No metrics have been added."}
                </i>
              </Text>
            </Box>
          ) : !isImbalanced ? (
            <Callout status="success">
              <Text weight="semibold">
                {goalAndGuardrailMetricsTested} goal or guardrail
              </Text>{" "}
              <Text as="span" weight="semibold">
                {goalAndGuardrailMetricsTested > 1
                  ? "results show"
                  : "result shows"}{" "}
                no pre-exposure imbalance
              </Text>
              .{" "}
              <Text weight="semibold">
                <Link
                  href="https://docs.growthbook.io/app/experiment-results#pre-exposure-mean-imbalance"
                  target="_blank"
                >
                  Learn more
                </Link>
              </Text>
              <Box display="inline-block" ml="1">
                <PiArrowSquareOut size={15} />
              </Box>
            </Callout>
          ) : (
            <Callout status="warning">
              Pre-exposure imbalance detected in{" "}
              <Text weight="semibold">
                {goalAndGuardrailMetricsImbalanced} goal and guardrail metric
                {goalAndGuardrailMetricsImbalanced !== 1 ? "s" : ""}
              </Text>{" "}
              (significance level{" "}
              {DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE},
              Bonferroni-corrected for {numBonferroniTests} test
              {numBonferroniTests !== 1 ? "s" : ""}).{" "}
              <Text weight="semibold">
                <Link
                  href="https://docs.growthbook.io/app/experiment-results#pre-exposure-mean-imbalance"
                  target="_blank"
                >
                  Learn more
                </Link>
              </Text>
              <Box display="inline-block" ml="1">
                <PiArrowSquareOut size={15} />
              </Box>
            </Callout>
          )}
        </Box>
      </Box>
      {!isCollapsed && covariateImbalanceResult && (
        <Box mt="4">
          <CovariateImbalanceTable
            covariateImbalanceResult={covariateImbalanceResult}
            variations={variations}
            goalMetricIds={goalMetricIds}
            secondaryMetricIds={secondaryMetricIds}
            guardrailMetricIds={guardrailMetricIds}
          />
        </Box>
      )}
    </Box>
  );
}
