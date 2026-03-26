import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentReportVariation } from "shared/types/report";
import { useEffect, useState } from "react";
import { CovariateImbalanceResult } from "shared/health";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCaretDown, PiCaretRight } from "react-icons/pi";
import { DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE } from "shared/constants";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import CovariateImbalanceTable from "@/components/Experiment/TabbedPage/CovariateImbalanceTable";
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

/** Set to `true` locally to preview imbalanced covariate UI without snapshot data. */
const USE_COVARIATE_IMBALANCE_IMBALANCED_FIXTURE = false;

const testCovariateImbalanceResult: CovariateImbalanceResult = {
  isImbalanced: true,
  pValueThreshold: DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE,
  numGoalMetrics: 3,
  numGoalMetricsImbalanced: 2,
  numGuardrailMetrics: 1,
  numGuardrailMetricsImbalanced: 1,
  numSecondaryMetrics: 3,
  numSecondaryMetricsImbalanced: 1,
  metricVariationCovariateImbalanceResults: [
    {
      metricId: "fact__367olmrmljuqf5d",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.12,
      variationMean: 0.18,
      baselineStandardError: 0.004,
      variationStandardError: 0.0042,
      pValue: 0.00005,
    },
    {
      metricId: "fact__demo-d7-purchase-retention",
      variation: 1,
      isImbalanced: false,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf6l",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
    {
      metricId: "fact__367olmrmljuqf5e",
      variation: 1,
      isImbalanced: true,
      baselineSampleSize: 5000,
      variationSampleSize: 4800,
      baselineMean: 0.05,
      variationMean: 0.09,
      baselineStandardError: 0.003,
      variationStandardError: 0.0031,
      pValue: 0.0002,
    },
  ],
};

export default function CovariateImbalanceCard({
  experiment,
  variations,
  snapshot,
  onNotify,
}: Props) {
  const covariateImbalanceResult = USE_COVARIATE_IMBALANCE_IMBALANCED_FIXTURE
    ? testCovariateImbalanceResult
    : snapshot?.health?.covariateImbalance;

  const isImbalanced = covariateImbalanceResult?.isImbalanced ?? false;

  const [isCollapsed, setIsCollapsed] = useState(isImbalanced ? false : true);

  const metricIdsWithCupedEnabled = new Set(
    snapshot.settings.metricSettings
      .filter((m) => m.computedSettings?.regressionAdjustmentEnabled)
      .map((m) => m.id),
  );

  const goalMetricIds = experiment.goalMetrics.filter((id) =>
    metricIdsWithCupedEnabled.has(id),
  );
  const secondaryMetricIds = experiment.secondaryMetrics.filter((id) =>
    metricIdsWithCupedEnabled.has(id),
  );
  const guardrailMetricIds = experiment.guardrailMetrics.filter((id) =>
    metricIdsWithCupedEnabled.has(id),
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

  const pValueThreshold =
    covariateImbalanceResult?.pValueThreshold ??
    DEFAULT_P_VALUE_THRESHOLD_FOR_COVARIATE_IMBALANCE;

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
          Detects differences in pre-exposure control vs treatment means
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
                <i>No metrics have been added.</i>
              </Text>
            </Box>
          ) : !isImbalanced ? (
            <Callout status="success">
              <Text weight="semibold">
                {goalAndGuardrailMetricsTested} metric
                {goalAndGuardrailMetricsTested > 1 ? "s" : ""} show
                {goalAndGuardrailMetricsTested > 1 ? "" : "s"} no covariate
                imbalance.{" "}
                <Link
                  href="https://docs.growthbook.io/app/experiment-results#pre-exposure-mean-imbalance"
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
                {goalAndGuardrailMetricsImbalanced} goal or guardrail metric
                {goalAndGuardrailMetricsImbalanced > 1 ? "s" : ""}
              </Text>{" "}
              show{goalAndGuardrailMetricsImbalanced > 1 ? "" : "s"}{" "}
              pre-exposure imbalance (significance level {pValueThreshold}).{" "}
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
