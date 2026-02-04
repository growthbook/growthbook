import React, { ReactNode } from "react";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { upperFirst } from "lodash";
import {
  ExperimentReportVariationWithIndex,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MdSwapCalls } from "react-icons/md";
import { PiInfo } from "react-icons/pi";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { getVariationColor } from "@/services/features";
import { getEffectLabel, RowResults } from "@/services/experiments";
import {
  formatPercent,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import FlagCard from "@/components/FlagCard/FlagCard";
import { PercentileLabel } from "@/components/Metrics/MetricName";
import Callout from "@/ui/Callout";
import VariationStatsTable from "@/ui/VariationStatsTable";

export interface AnalysisResultSummaryProps {
  data?: {
    metricRow: number;
    metric: ExperimentMetricInterface;
    metricSnapshotSettings?: MetricSnapshotSettings;
    dimensionName?: string;
    dimensionValue?: string | ReactNode;
    sliceLevels?: Array<{
      dimension: string;
      levels: string[];
    }>;
    variation: ExperimentReportVariationWithIndex;
    stats: SnapshotMetric;
    baseline: SnapshotMetric;
    baselineVariation: ExperimentReportVariationWithIndex;
    rowResults: RowResults;
    statsEngine: StatsEngine;
    pValueCorrection?: PValueCorrection;
    isGuardrail: boolean;
  };
  differenceType: DifferenceType;
  isBandit?: boolean;
  ssrPolyfills?: SSRPolyfills;
}

export default function AnalysisResultSummary({
  data,
  differenceType,
  isBandit,
  ssrPolyfills,
}: AnalysisResultSummaryProps) {
  const _currency = useCurrency();
  const displayCurrency = ssrPolyfills?.useCurrency?.() || _currency;

  const { getFactTableById } = useDefinitions();

  const _pValueThreshold = usePValueThreshold();
  const pValueThreshold =
    ssrPolyfills?.usePValueThreshold?.() || _pValueThreshold;

  if (!data) return null;

  const deltaFormatter =
    differenceType === "relative"
      ? formatPercent
      : getExperimentMetricFormatter(
          data.metric,
          ssrPolyfills?.getFactTableById || getFactTableById,
          differenceType === "absolute" ? "percentagePoints" : "number",
        );
  const deltaFormatterOptions = {
    currency: displayCurrency,
    ...(differenceType === "relative" ? { maximumFractionDigits: 2 } : {}),
  };
  const effectLabel = getEffectLabel(differenceType);

  const metricInverseIconDisplay = data.metric.inverse ? (
    <Tooltip content="Metric is inverse, lower is better">
      <span>
        <MdSwapCalls />
      </span>
    </Tooltip>
  ) : null;

  const variationColor = getVariationColor(data.variation.index, true);

  const tableRows = [
    {
      variationIndex: data.baselineVariation.index,
      variationName: data.baselineVariation.name,
      stats: data.baseline,
      isBaseline: true,
    },
    {
      variationIndex: data.variation.index,
      variationName: data.variation.name,
      stats: data.stats,
      isBaseline: false,
    },
  ];

  const maybeRenderRegressionAdjustmentInfo = () => {
    const cupedUsed = data.metricSnapshotSettings?.regressionAdjustmentEnabled;
    const priorUsed =
      data.statsEngine === "bayesian" &&
      data.metricSnapshotSettings?.properPrior;

    if (!data.rowResults.enoughData || (!priorUsed && !cupedUsed)) {
      return null;
    }

    return (
      <Callout size="sm" status="info" icon={null}>
        {priorUsed && cupedUsed ? (
          <>CUPED and Bayesian Priors affect results</>
        ) : priorUsed ? (
          <>Bayesian Priors affect results</>
        ) : (
          <>CUPED affects results</>
        )}{" "}
        <Tooltip
          content={
            <Flex direction="column" gap="1">
              {priorUsed ? (
                <span>
                  {`This metric was analyzed with a prior that is normally distributed with mean ${
                    data.metricSnapshotSettings?.properPriorMean ?? 0
                  } and standard deviation ${
                    data.metricSnapshotSettings?.properPriorStdDev ??
                    DEFAULT_PROPER_PRIOR_STDDEV
                  }.`}
                </span>
              ) : null}
              {cupedUsed ? (
                <span>
                  {`This metric was analyzed with CUPED, which adjusts for covariates.`}
                </span>
              ) : null}
              <span>
                {`This affects metrics results (e.g., lift, ${
                  data.statsEngine === "bayesian"
                    ? "chance to win, credible intervals"
                    : "p-values, confidence intervals"
                }), and estimated lift will often differ from the raw difference between variation and baseline.`}
              </span>
            </Flex>
          }
        >
          <span>
            <PiInfo size={16} />
          </span>
        </Tooltip>
      </Callout>
    );
  };

  return (
    <Box p="2">
      {data.isGuardrail ? (
        <div
          className="text-muted"
          style={{ marginBottom: -2, fontSize: "10px" }}
        >
          GUARDRAIL
        </div>
      ) : null}

      <Flex direction="column" gap="2" mb="3">
        <Flex gap="1" align="center">
          <Text
            weight="medium"
            size="2"
            className="text-ellipsis"
            style={{ maxWidth: 350 }}
          >
            {data.metric.name}
          </Text>
          <PercentileLabel metric={data.metric} />
          <Text weight="regular" size="2" color="gray">
            (
            {upperFirst(
              isFactMetric(data.metric)
                ? data.metric.metricType
                : data.metric.type,
            )}
            )
          </Text>
          {metricInverseIconDisplay}
        </Flex>
        {data.dimensionName ? (
          <Flex gap="1" mt="-1" align="center">
            <span className="uppercase-title">Unit dimension:</span>{" "}
            <Flex gap="1">
              <span className="text-ellipsis" style={{ maxWidth: 150 }}>
                {data.dimensionName}:
              </span>
              <span className="text-ellipsis" style={{ maxWidth: 250 }}>
                {data.dimensionValue}
              </span>
            </Flex>
          </Flex>
        ) : null}

        <Flex align="center" gap="2">
          <span
            style={{
              color: variationColor,
              borderColor: variationColor,
              fontSize: "12px",
              width: 16,
              height: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderStyle: "solid",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {data.variation.index}
          </span>
          <Text weight="bold" className="text-ellipsis">
            {data.variation.name}
          </Text>
        </Flex>
      </Flex>

      <Box mb="4">
        <FlagCard
          effectLabel={effectLabel}
          deltaFormatter={deltaFormatter}
          deltaFormatterOptions={deltaFormatterOptions}
          pValueThreshold={pValueThreshold}
          data={data}
        />
      </Box>

      <VariationStatsTable
        metric={data.metric}
        rows={tableRows}
        isBandit={isBandit}
        ssrPolyfills={ssrPolyfills}
      />

      <Flex direction="column" gap="2">
        {maybeRenderRegressionAdjustmentInfo()}
      </Flex>
    </Box>
  );
}
